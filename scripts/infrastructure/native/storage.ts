import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Registry, Site } from '../../../src/domain/registry';
import { DEFAULT_REGISTRY_FILENAME } from '../../../src/lib/constants';
import { createBuildArtifact, type BuildArtifact } from '../../core/content/build-artifact';
import { createStoragePublisher, type RemoteStorage, type PreparedStoragePublication } from '../../core/storage/publication';
import { getStorageKey } from '../../core/storage/paths';
import type { StageTimer } from '../../core/stage-timing';
import { compareStrings } from '../../core/order';
import type { ContentSnapshot } from '../../core/content/content-snapshot';
import { assertInventorySourceHashes } from '../../core/storage/inventory';
import { getStorageConnection, type StorageConnection } from './storage-config';
import { connectS3Storage } from './s3-store';
import { createVaultStorageFiles, createVaultStorageInventory, type VaultStorageFiles } from './vault-inventory';

export type PreparedNativeSite = PreparedStoragePublication & { close: () => void };

export function createNativeSitePreparation({ resolveConnection, connect, createFiles, newGeneration, logger }: {
  resolveConnection: (input: { site: Site; registry: Registry }) => StorageConnection;
  connect: (connection: StorageConnection) => { remote: RemoteStorage; close: () => void };
  createFiles: (vaultPath: string) => VaultStorageFiles;
  newGeneration: () => string;
  logger: Pick<typeof console, 'log'>;
}) {
  return async function prepareNativeSite({ site, registry, generatedArtifacts, contentSnapshot, sourceArtifacts = [], deleteRemoteFiles, reconcile = false, recover = false, verbose, stageTimer }: {
    site: Site;
    registry: Registry;
    generatedArtifacts: readonly BuildArtifact[];
    contentSnapshot?: ContentSnapshot;
    sourceArtifacts?: readonly BuildArtifact[];
    deleteRemoteFiles: boolean;
    reconcile?: boolean;
    recover?: boolean;
    verbose: boolean;
    stageTimer: StageTimer;
  }): Promise<PreparedNativeSite> {
    const connection = resolveConnection({ site, registry });
    const storage = connect(connection);
    try {
      const inventory = createVaultStorageInventory(createFiles(site.vaultPath));
      const local = await stageTimer.measure({
        stage: 'storage.inventory', run: () => inventory.collect({ generatedArtifacts }),
      });
      assertInventorySourceHashes({
        artifacts: local,
        sources: [
          ...(contentSnapshot?.documents || []).map((document) => ({ path: path.relative(site.vaultPath, document.localPath).replace(/\\/g, '/'), contentHash: document.sourceHash })),
          ...sourceArtifacts,
        ],
      });
      const registryArtifact = createBuildArtifact({
        path: DEFAULT_REGISTRY_FILENAME,
        content: JSON.stringify({
          sites: registry.sites.filter((candidate) => candidate.bucketName === site.bucketName)
            .map((candidate) => ({ domain: candidate.domain, siteId: candidate.siteId }))
            .sort((left, right) => compareStrings({ left: left.siteId, right: right.siteId })),
        }, null, 2),
      });
      const prepare = createStoragePublisher({
        remote: storage.remote, newGeneration, logger,
        materialize: () => inventory.materialize(generatedArtifacts),
      });
      const publication = await stageTimer.measure({
        stage: 'storage.compare',
        run: () => prepare({
          target: connection.target, deleteRemoteFiles, reconcile, recover, verbose,
          artifacts: [
            ...local.map((artifact) => ({ ...artifact, key: getStorageKey({ siteId: site.siteId, path: artifact.path }) })),
            { ...registryArtifact, key: DEFAULT_REGISTRY_FILENAME },
          ],
        }),
      });
      return {
        plan: publication.plan,
        apply: ({ dryRun }) => dryRun
          ? publication.apply({ dryRun })
          : stageTimer.measure({ stage: 'storage.sync', run: () => publication.apply({ dryRun }) }),
        close: storage.close,
      };
    } catch (error: unknown) {
      storage.close();
      throw error;
    }
  };
}

export const prepareNativeSite = createNativeSitePreparation({
  resolveConnection: getStorageConnection,
  connect: (connection) => connectS3Storage({ connection, region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'auto' }),
  createFiles: (vaultPath) => createVaultStorageFiles({ vaultPath }),
  newGeneration: randomUUID,
  logger: console,
});
