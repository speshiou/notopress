import { createStorageBaselineInitializer, type PreparedStorageBaseline } from '../../core/storage/baseline';
import { nativeStorageDependencies, type NativeStoragePreparationDeps } from './storage';
import { prepareStorageArtifacts, type NativeStorageBuildInput } from './storage-artifacts';

export function createNativeBaselinePreparation({ resolveConnection, connect, createFiles, newGeneration }: NativeStoragePreparationDeps) {
  return async function prepareNativeBaseline(input: NativeStorageBuildInput & {
    trustLocal: boolean;
    pendingKeys: readonly string[];
  }): Promise<PreparedStorageBaseline & { close: () => void }> {
    const connection = resolveConnection(input);
    const storage = connect(connection);
    try {
      const { artifacts } = await prepareStorageArtifacts({ input, files: createFiles(input.site.vaultPath) });
      const prepare = createStorageBaselineInitializer({ remote: storage.remote, newGeneration });
      const baseline = await input.stageTimer.measure({ stage: 'storage.compare', run: () => prepare({
        target: connection.target, artifacts, trustLocal: input.trustLocal, pendingKeys: input.pendingKeys,
      }) });
      return { ...baseline, close: storage.close };
    } catch (error: unknown) {
      storage.close();
      throw error;
    }
  };
}

export const prepareNativeBaseline = createNativeBaselinePreparation(nativeStorageDependencies);
