import { z } from 'zod';
import { DEFAULT_REGISTRY_FILENAME } from '../../../src/lib/constants';
import { readVerifiedArtifact } from '../content/build-artifact';
import { compareStrings } from '../order';
import { assertOperationPlanFingerprint, createOperationPlan, type OperationPlan } from '../publishing/operation-plan';
import { StorageManifestSchema, StorageTargetSchema, type StorageEntry, type StorageTarget } from './manifest';
import { isRelativeObjectPath } from './paths';
import type { RemoteStorage, StorageArtifact } from './publication';
import { indexStorageArtifacts, indexStorageEntries, sortStorageEntries } from './validation';

type LocalBaselineFile = Pick<StorageArtifact, 'key' | 'size' | 'contentHash'>;
export type StorageBaselineOperation =
  | { action: 'initialize'; target: StorageTarget; trustLocal: true; pendingKeys: readonly string[] }
  | { action: 'assume-synced' | 'keep-pending' | 'retain'; entry: StorageEntry; local?: LocalBaselineFile }
  | { action: 'missing'; local: LocalBaselineFile };

export type PreparedStorageBaseline = {
  plan: OperationPlan<StorageBaselineOperation>;
  apply: (input: { dryRun: boolean; expectedFingerprint?: string }) => Promise<void>;
};

const PendingKeysSchema = z.array(z.string().refine(isRelativeObjectPath));
export function parsePendingStorageKeys(source: string): string[] {
  try {
    const result = PendingKeysSchema.parse(JSON.parse(source));
    if (new Set(result).size !== result.length) throw new Error('Duplicate key.');
    return result;
  } catch {
    throw new Error('Pending uploads must be a JSON array of unique relative storage object keys.');
  }
}

export function createStorageBaselineInitializer({ remote, newGeneration }: {
  remote: RemoteStorage;
  newGeneration: () => string;
}) {
  return async function prepareBaseline({ target: suppliedTarget, artifacts, pendingKeys = [], trustLocal }: {
    target: StorageTarget;
    artifacts: readonly StorageArtifact[];
    pendingKeys?: readonly string[];
    trustLocal: boolean;
  }): Promise<PreparedStorageBaseline> {
    if (!trustLocal) throw new Error('Storage initialization requires explicit --trust-local.');
    const target = StorageTargetSchema.parse(suppliedTarget);
    const expected = indexStorageArtifacts({ target, artifacts });
    const pending = new Set(pendingKeys);
    if (pending.size !== pendingKeys.length) throw new Error('Duplicate pending upload key.');
    for (const key of pending) {
      if (!expected.has(key)) throw new Error(`Pending key is not an expected storage artifact: ${key}`);
    }
    async function requireAbsentManifest() {
      if (await remote.readManifest()) throw new Error('Storage manifest already exists. Initialization cannot overwrite ready, pending, or invalid state.');
    }
    async function discoverMetadata(): Promise<StorageEntry[]> {
      const entries = indexStorageEntries({ target, entries: await remote.listObjects() });
      const shared = await remote.inspectObject(DEFAULT_REGISTRY_FILENAME);
      if (shared) {
        if (shared.key !== DEFAULT_REGISTRY_FILENAME) throw new Error('Invalid shared storage object.');
        entries.set(shared.key, shared);
      }
      return sortStorageEntries(indexStorageEntries({ target, entries: [...entries.values()].map((entry) => ({ ...entry, contentHash: null })) }).values());
    }
    await requireAbsentManifest();
    const discovered = await discoverMetadata();
    const operations: StorageBaselineOperation[] = [{
      action: 'initialize', target, trustLocal: true,
      pendingKeys: [...pending].sort((left, right) => compareStrings({ left, right })),
    }];
    const seen = new Set<string>();
    for (const remoteEntry of discovered) {
      const artifact = expected.get(remoteEntry.key);
      seen.add(remoteEntry.key);
      const local = artifact ? { key: artifact.key, size: artifact.size, contentHash: artifact.contentHash } : undefined;
      const assume = local && !pending.has(remoteEntry.key) && local.size === remoteEntry.size;
      operations.push({
        action: assume ? 'assume-synced' : local ? 'keep-pending' : 'retain',
        entry: { ...remoteEntry, contentHash: assume ? local.contentHash : null },
        ...(local ? { local } : {}),
      });
    }
    for (const artifact of [...expected.values()].sort((left, right) => compareStrings({ left: left.key, right: right.key }))) {
      if (!seen.has(artifact.key)) operations.push({ action: 'missing', local: { key: artifact.key, size: artifact.size, contentHash: artifact.contentHash } });
    }
    const plan = createOperationPlan({ kind: 'notopress-storage-baseline', operations, serializeOperation: (operation) => operation });
    return {
      plan,
      async apply({ dryRun, expectedFingerprint }) {
        if (!dryRun && !expectedFingerprint) throw new Error('Live storage initialization requires a reviewed --expect fingerprint.');
        assertOperationPlanFingerprint({ label: 'Storage baseline', plan, expectedFingerprint });
        if (dryRun) return;
        for (const artifact of artifacts) {
          if (artifact.verify) await artifact.verify();
          else await readVerifiedArtifact(artifact);
        }
        await requireAbsentManifest();
        if (JSON.stringify(await discoverMetadata()) !== JSON.stringify(discovered)) {
          throw new Error('Remote storage changed after baseline planning. Run the dry-run again.');
        }
        const entries = operations.flatMap((operation) => 'entry' in operation ? [operation.entry] : []);
        const manifest = StorageManifestSchema.parse({ version: 1, target, generation: newGeneration(), status: 'ready', planFingerprint: plan.fingerprint, entries });
        try {
          await remote.writeManifest({ manifest, expectedEtag: null });
        } catch {
          throw new Error('Baseline write failed or its outcome is uncertain. Inspect remote state before proceeding; do not retry writes automatically.');
        }
      },
    };
  };
}

export function formatStorageBaselinePlan({ plan, verbose = false }: {
  plan: OperationPlan<StorageBaselineOperation>;
  verbose?: boolean;
}): string {
  const assumed = plan.operations.filter((operation) => operation.action === 'assume-synced');
  const pending = plan.operations.filter((operation) => operation.action === 'keep-pending' || operation.action === 'missing');
  const retained = plan.operations.filter((operation) => operation.action === 'retain');
  const lines = [
    `Storage baseline plan ${plan.fingerprint}: ${assumed.length} assumed synced, ${pending.length} pending, ${retained.length} remote-only retained.`,
    'Trusting matching-size local files without downloading remote contents. Same-size differences not listed as pending will be assumed synced.',
    'Apply writes only a new storage manifest: no article uploads, deletions, generated-file writes, or WordPress changes. Stop other storage writers before initialization.',
  ];
  for (const operation of pending) if ('local' in operation && operation.local) lines.push(`  pending-upload: ${operation.local.key}`);
  if (verbose) lines.push(JSON.stringify(plan, null, 2));
  return lines.join('\n');
}
