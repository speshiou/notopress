import type { BuildArtifact } from '../content/build-artifact';
import { createOperationPlan } from '../publishing/operation-plan';
import { compareStrings } from '../order';
import type { StorageTarget } from './target';
import { DEFAULT_REGISTRY_FILENAME } from '../../../src/lib/constants';

export type AwsStorageOperation =
  | { action: 'sync'; target: StorageTarget; deleteRemoteFiles: boolean; files: readonly Pick<BuildArtifact, 'path' | 'size' | 'contentHash'>[]; preview: readonly string[] }
  | { action: 'upload-distribution'; assetsOnly?: boolean; target: StorageTarget; files: readonly Pick<BuildArtifact, 'path' | 'size' | 'contentHash'>[]; preview: readonly string[] }
  | { action: 'upload-registry'; contentHash: string; size: number };

export function normalizeAwsPreview({ output, snapshotPath }: { output: string; snapshotPath: string }): string[] {
  return output.split(/\r?\n/).filter((line) => line.trim().length > 0)
    .map((line) => line.split(snapshotPath).join('<prepared-vault>'))
    .sort((left, right) => compareStrings({ left, right }));
}

export function createAwsStoragePlan({ target, artifacts, deleteRemoteFiles, preview, incremental = false, assetsOnly = false }: {
  target: StorageTarget;
  artifacts: readonly (BuildArtifact & { key: string })[];
  deleteRemoteFiles: boolean;
  preview: readonly string[];
  incremental?: boolean;
  assetsOnly?: boolean;
}) {
  const registry = artifacts.find((artifact) => artifact.key === DEFAULT_REGISTRY_FILENAME);
  if (assetsOnly && (!incremental || deleteRemoteFiles || registry)) {
    throw new Error('Adapter asset plans require explicit uploads without deletion or a native registry.');
  }
  if (!registry && !assetsOnly) throw new Error('Prepared registry artifact is missing.');
  const files = artifacts.filter((artifact) => artifact !== registry)
      .map(({ path, size, contentHash }) => ({ path, size, contentHash }))
      .sort((left, right) => compareStrings({ left: left.path, right: right.path }));
  if (incremental && deleteRemoteFiles) throw new Error('Incremental publishing cannot delete remote objects. Use sync --delete with a reviewed plan.');
  const operations: AwsStorageOperation[] = [incremental
    ? { action: 'upload-distribution', target, files, preview, ...(assetsOnly ? { assetsOnly: true } : {}) }
    : { action: 'sync', target, deleteRemoteFiles, files, preview }];
  if (registry) operations.push({ action: 'upload-registry', contentHash: registry.contentHash, size: registry.size });
  return createOperationPlan({ kind: 'notopress-storage-aws-cli', operations, serializeOperation: (operation) => operation });
}
