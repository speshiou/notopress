import type { BuildArtifact } from '../content/build-artifact';
import { readVerifiedArtifact } from '../content/build-artifact';
import { createOperationPlan, type OperationPlan } from '../publishing/operation-plan';
import { mapWithConcurrency } from '../concurrency';
import {
  StorageManifestSchema, StorageTargetSchema, sameStorageTarget,
  type StorageManifest, type StorageEntry, type StorageTarget,
} from './manifest';
import { compareStrings } from '../order';
import { indexStorageArtifacts, indexStorageEntries, sortStorageEntries } from './validation';

export type StorageArtifact = BuildArtifact & { key: string };
export type ManifestRead = { etag: string; body: unknown };
export type RemoteStorage = {
  maxUploadBytes?: number;
  readManifest: () => Promise<ManifestRead | null>;
  listObjects: () => Promise<StorageEntry[]>;
  inspectObject: (key: string) => Promise<StorageEntry | null>;
  hashObject: (entry: StorageEntry) => Promise<StorageEntry>;
  writeManifest: (input: { manifest: StorageManifest; expectedEtag: string | null }) => Promise<string>;
  upload: (input: { key: string; bytes: Uint8Array; contentHash: string; expectedEtag: string | null }) => Promise<string>;
  delete: (entry: StorageEntry) => Promise<void>;
};

export type StorageOperation =
  | { action: 'state'; target: StorageTarget; manifestEtag: string | null; mode: 'bootstrap' | 'incremental' | 'reconcile' | 'recover'; deleteRemoteFiles: boolean }
  | { action: 'upload' | 'skip'; key: string; size: number; contentHash: string; expectedEtag: string | null }
  | { action: 'delete' | 'retain'; entry: StorageEntry };

export type PreparedStoragePublication = {
  plan: OperationPlan<StorageOperation>;
  apply: (input: { dryRun: boolean }) => Promise<void>;
};

export function createStoragePublisher({ remote, newGeneration, materialize, logger }: {
  remote: RemoteStorage;
  newGeneration: () => string;
  materialize: () => Promise<void>;
  logger: Pick<typeof console, 'log'>;
}) {
  return async function prepareStoragePublication({ target: suppliedTarget, artifacts: suppliedArtifacts, deleteRemoteFiles, reconcile = false, recover = false, verbose = false }: {
    target: StorageTarget;
    artifacts: readonly StorageArtifact[];
    deleteRemoteFiles: boolean;
    reconcile?: boolean;
    recover?: boolean;
    verbose?: boolean;
  }): Promise<PreparedStoragePublication> {
    const target = StorageTargetSchema.parse(suppliedTarget);
    const artifacts = suppliedArtifacts.map((artifact) => ({ ...artifact }));
    if (recover && !reconcile) throw new Error('--recover-storage requires --reconcile-storage and all previous publishers to be stopped.');
    const snapshot = await remote.readManifest();
    const parsed = snapshot ? StorageManifestSchema.safeParse(snapshot.body) : null;
    const manifest = parsed?.success ? parsed.data : null;
    if (manifest && !sameStorageTarget({ left: manifest.target, right: target })) {
      throw new Error('Storage manifest belongs to a different destination. Refusing publication.');
    }
    if (snapshot && !manifest && !recover) {
      throw new Error('Invalid or unsupported storage manifest. Stop publishers and use --reconcile-storage --recover-storage to rebuild it.');
    }
    if (manifest?.status === 'pending' && !recover) {
      throw new Error('Storage publication is pending or interrupted. Stop the previous publisher, then preview --reconcile-storage --recover-storage.');
    }
    const mode = recover ? 'recover' : reconcile ? 'reconcile' : manifest ? 'incremental' : 'bootstrap';
    const discovered = mode === 'incremental' ? manifest?.entries || [] : await remote.listObjects();
    const baseline = indexStorageEntries({ target, entries: discovered });
    const expected = indexStorageArtifacts({ target, artifacts });

    // Shared bucket objects require a fresh read even when the site manifest is current.
    for (const artifact of artifacts.filter((artifact) => !artifact.key.startsWith(`${target.siteId}/`))) {
      const entry = await remote.inspectObject(artifact.key);
      if (entry) baseline.set(entry.key, await remote.hashObject(entry));
      else baseline.delete(artifact.key);
    }
    if (mode !== 'incremental') {
      await mapWithConcurrency({
        items: artifacts.filter((artifact) => artifact.key.startsWith(`${target.siteId}/`) && baseline.has(artifact.key)),
        concurrency: 8,
        worker: async (artifact) => {
          const entry = baseline.get(artifact.key);
          if (entry) baseline.set(entry.key, await remote.hashObject(entry));
        },
      });
    }

    const operations: StorageOperation[] = [{
      action: 'state', target, manifestEtag: snapshot?.etag || null, mode, deleteRemoteFiles,
    }];
    for (const artifact of [...expected.values()].sort((left, right) => compareStrings({ left: left.key, right: right.key }))) {
      const prior = baseline.get(artifact.key);
      operations.push({
        action: prior?.contentHash === artifact.contentHash && prior.size === artifact.size ? 'skip' : 'upload',
        key: artifact.key, size: artifact.size, contentHash: artifact.contentHash, expectedEtag: prior?.etag || null,
      });
    }
    for (const entry of sortStorageEntries(baseline.values())) {
      if (expected.has(entry.key)) continue;
      // Only site-scoped objects may be deleted; shared bucket state is never pruned here.
      operations.push({ action: deleteRemoteFiles && entry.key.startsWith(`${target.siteId}/`) ? 'delete' : 'retain', entry });
    }
    const plan = createOperationPlan({ kind: 'notopress-storage', operations, serializeOperation: (operation) => operation });
    const uploads = operations.filter((operation): operation is Extract<StorageOperation, { key: string }> => operation.action === 'upload');
    const deletes = operations.filter((operation): operation is Extract<StorageOperation, { entry: StorageEntry }> => operation.action === 'delete');
    const skips = operations.filter((operation): operation is Extract<StorageOperation, { key: string }> => operation.action === 'skip');
    const maxUploadBytes = remote.maxUploadBytes;
    if (maxUploadBytes !== undefined && uploads.some((operation) => operation.size > maxUploadBytes)) {
      throw new Error('An upload exceeds the storage transport size limit. No objects were mutated.');
    }
    logger.log(`Vault backup/sync (S3/R2) plan ${plan.fingerprint}: ${mode}; ${uploads.length} upload(s), ${deletes.length} deletion(s), ${skips.length} unchanged.`);
    for (const operation of operations) {
      if (operation.action === 'upload' || operation.action === 'delete' || (verbose && operation.action === 'skip')) {
        logger.log(`  storage-${operation.action}: ${'key' in operation ? operation.key : operation.entry.key}`);
      }
    }

    return {
      plan,
      async apply({ dryRun }) {
        if (dryRun) return;
        // Check all local inputs before reserving remote state or writing generated files.
        for (const artifact of artifacts) {
          if (artifact.verify) await artifact.verify();
          else await readVerifiedArtifact(artifact);
        }
        const current = await remote.readManifest();
        if ((current?.etag || null) !== (snapshot?.etag || null)) {
          throw new Error('Storage manifest changed after planning. Run the dry-run again.');
        }
        const baselineChanged = manifest && JSON.stringify(sortStorageEntries(manifest.entries)) !== JSON.stringify(sortStorageEntries(baseline.values()));
        if (mode === 'incremental' && uploads.length === 0 && deletes.length === 0 && !baselineChanged) {
          await materialize();
          return;
        }
        const generation = newGeneration();
        const reservation: StorageManifest = {
          version: 1, target, generation, status: 'pending', planFingerprint: plan.fingerprint,
          entries: sortStorageEntries(baseline.values()),
        };
        // CAS both missing and existing manifests. No clock-based lock expiry or automatic takeover.
        let reservationEtag: string;
        try {
          reservationEtag = await remote.writeManifest({ manifest: reservation, expectedEtag: snapshot?.etag || null });
        } catch {
          throw new Error('Could not reserve the reviewed storage generation. Run a dry-run to inspect current state; do not retry writes automatically.');
        }
        const nextEntries = new Map(baseline);
        try {
          await materialize();
          await mapWithConcurrency({
            items: uploads, concurrency: 4,
            worker: async (operation) => {
              const artifact = expected.get(operation.key);
              if (!artifact) throw new Error('Prepared storage artifact is missing.');
              const bytes = await readVerifiedArtifact(artifact);
              const etag = await remote.upload({ key: operation.key, bytes, contentHash: operation.contentHash, expectedEtag: operation.expectedEtag });
              nextEntries.set(operation.key, { key: operation.key, size: operation.size, contentHash: operation.contentHash, etag });
            },
          });
          for (const operation of deletes) {
            await remote.delete(operation.entry);
            nextEntries.delete(operation.entry.key);
          }
          // Unknown legacy hashes for skipped artifacts become verified portable SHA-256 entries.
          for (const operation of skips) {
            if (!operation.expectedEtag) throw new Error('Skipped storage object lacks a remote precondition.');
            nextEntries.set(operation.key, { key: operation.key, size: operation.size, contentHash: operation.contentHash, etag: operation.expectedEtag });
          }
          await remote.writeManifest({
            manifest: { ...reservation, status: 'ready', entries: sortStorageEntries(nextEntries.values()) },
            expectedEtag: reservationEtag,
          });
        } catch {
          // An ambiguous write may have succeeded. Keep the reservation and require explicit reconciliation.
          throw new Error('Storage apply did not complete or its outcome is uncertain. Run a dry-run; if the manifest is pending, stop publishers and preview --reconcile-storage --recover-storage.');
        }
      },
    };
  };
}
