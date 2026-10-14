import { assertArtifactHash, type BuildArtifact } from '../content/build-artifact';
import { isPublishableVaultPath } from './paths';
import { isGeneratedArtifactPath } from '../content/generated-paths';
import { compareStrings } from '../order';

export type InventoryFile = { path: string; kind: 'file' | 'directory' | 'unsupported' };

export function assertInventorySourceHashes({ artifacts, sources }: {
  artifacts: readonly BuildArtifact[];
  sources: readonly Pick<BuildArtifact, 'path' | 'contentHash'>[];
}): void {
  const hashes = new Map(artifacts.map((artifact) => [artifact.path, artifact.contentHash]));
  for (const source of sources) {
    if (hashes.get(source.path) !== source.contentHash) {
      throw new Error(`Build source changed during preparation: ${source.path}. Run the dry-run again.`);
    }
  }
}

export function createStorageInventory({ listDirectory, hashFile, readFile }: {
  listDirectory: (path: string) => Promise<readonly InventoryFile[]>;
  hashFile: (path: string) => Promise<{ size: number; contentHash: string }>;
  readFile: (path: string) => Promise<Uint8Array>;
}) {
  return async function collectStorageInventory({ generatedArtifacts }: {
    generatedArtifacts: readonly BuildArtifact[];
  }): Promise<BuildArtifact[]> {
    const artifacts = new Map<string, BuildArtifact>();
    for (const artifact of generatedArtifacts) {
      if (!isPublishableVaultPath(artifact.path) || artifacts.has(artifact.path)) {
        throw new Error('Invalid or duplicate generated storage artifact.');
      }
      artifacts.set(artifact.path, artifact);
    }
    async function walk(directory: string): Promise<void> {
      for (const entry of await listDirectory(directory)) {
        const filePath = directory ? `${directory}/${entry.path}` : entry.path;
        if (!isPublishableVaultPath(filePath)) continue;
        if (entry.kind === 'directory') await walk(filePath);
        else if (entry.kind === 'file') {
          if (artifacts.has(filePath) || isGeneratedArtifactPath(filePath)) continue;
          const hash = await hashFile(filePath);
          const artifact: BuildArtifact = {
            path: filePath, ...hash, read: () => readFile(filePath),
            verify: async () => assertArtifactHash({ artifact, actual: await hashFile(filePath) }),
          };
          artifacts.set(filePath, artifact);
        } else {
          throw new Error(`Unsupported storage entry: ${filePath}. Replace symbolic links with vault files.`);
        }
      }
    }
    await walk('');
    return [...artifacts.values()].sort((left, right) => compareStrings({ left: left.path, right: right.path }));
  };
}
