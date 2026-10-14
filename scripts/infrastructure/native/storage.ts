import { randomUUID } from 'node:crypto';
import { createStoragePublisher, type RemoteStorage, type PreparedStoragePublication } from '../../core/storage/publication';
import { getStorageConnection, type StorageConnection } from './storage-config';
import { connectS3Storage } from './s3-store';
import { createVaultStorageFiles, type VaultStorageFiles } from './vault-inventory';
import { prepareStorageArtifacts, type NativeStorageBuildInput } from './storage-artifacts';

export type PreparedNativeSite = PreparedStoragePublication & { close: () => void };

export type NativeStoragePreparationDeps = {
  resolveConnection: (input: Pick<NativeStorageBuildInput, 'site' | 'registry'>) => StorageConnection;
  connect: (connection: StorageConnection) => { remote: RemoteStorage; close: () => void };
  createFiles: (vaultPath: string) => VaultStorageFiles;
  newGeneration: () => string;
  logger: Pick<typeof console, 'log'>;
};

export function createNativeSitePreparation({ resolveConnection, connect, createFiles, newGeneration, logger }: NativeStoragePreparationDeps) {
  return async function prepareNativeSite(input: NativeStorageBuildInput & {
    deleteRemoteFiles: boolean;
    reconcile?: boolean;
    recover?: boolean;
    verbose: boolean;
  }): Promise<PreparedNativeSite> {
    const { site, registry, deleteRemoteFiles, reconcile = false, recover = false, verbose, stageTimer } = input;
    const connection = resolveConnection({ site, registry });
    const storage = connect(connection);
    try {
      const preparedArtifacts = await prepareStorageArtifacts({ input, files: createFiles(site.vaultPath) });
      const prepare = createStoragePublisher({
        remote: storage.remote, newGeneration, logger,
        materialize: preparedArtifacts.materialize,
      });
      const publication = await stageTimer.measure({
        stage: 'storage.compare',
        run: () => prepare({
          target: connection.target, deleteRemoteFiles, reconcile, recover, verbose,
          artifacts: preparedArtifacts.artifacts,
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

export const nativeStorageDependencies: NativeStoragePreparationDeps = {
  resolveConnection: getStorageConnection,
  connect: (connection) => connectS3Storage({ connection, region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'auto' }),
  createFiles: (vaultPath) => createVaultStorageFiles({ vaultPath }),
  newGeneration: randomUUID,
  logger: console,
};

export const prepareNativeSite = createNativeSitePreparation(nativeStorageDependencies);
