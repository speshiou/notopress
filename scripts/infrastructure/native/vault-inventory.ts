import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createStorageInventory, type InventoryFile } from '../../core/storage/inventory';
import { readVerifiedArtifact, type BuildArtifact } from '../../core/content/build-artifact';
import { hashByteStream } from './hash-stream';
import { isRelativeObjectPath } from '../../core/storage/paths';

export type VaultStorageFiles = {
  listDirectory: (directory: string) => Promise<readonly InventoryFile[]>;
  hashFile: (filePath: string) => Promise<{ size: number; contentHash: string }>;
  readFile: (filePath: string) => Promise<Uint8Array>;
  writeFile: (input: { filePath: string; bytes: Uint8Array }) => Promise<void>;
};

type NativeVaultFilesystem = {
  lstat: typeof lstat;
  readdir: (directory: string) => Promise<readonly { name: string; isDirectory: () => boolean; isFile: () => boolean }[]>;
  openReadStream: (filePath: string) => AsyncIterable<unknown>;
  readFile: (filePath: string) => Promise<Uint8Array>;
  mkdir: (directory: string) => Promise<unknown>;
  writeFile: (input: { filePath: string; bytes: Uint8Array }) => Promise<void>;
};

const nativeFilesystem: NativeVaultFilesystem = {
  lstat,
  readdir: (directory) => readdir(directory, { withFileTypes: true }),
  openReadStream: createReadStream,
  readFile,
  mkdir: (directory) => mkdir(directory, { recursive: true }),
  writeFile: ({ filePath, bytes }) => writeFile(filePath, bytes),
};

export function createVaultStorageFiles({ vaultPath, filesystem = nativeFilesystem }: {
  vaultPath: string;
  filesystem?: NativeVaultFilesystem;
}): VaultStorageFiles {
  async function resolveFile(filePath: string) {
    if (!isRelativeObjectPath(filePath)) throw new Error('Invalid vault file path.');
    const segments = filePath.split('/');
    let current = vaultPath;
    for (let index = 0; index < segments.length; index += 1) {
      current = path.join(current, segments[index]);
      const info = await filesystem.lstat(current);
      if (info.isSymbolicLink() || (index === segments.length - 1 ? !info.isFile() : !info.isDirectory())) {
        throw new Error(`Unsupported storage entry: ${filePath}. Replace symbolic links with vault files.`);
      }
    }
    return current;
  }
  return {
    listDirectory: async (directory) => (await filesystem.readdir(path.join(vaultPath, directory))).map((entry) => ({
      path: entry.name, kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'unsupported',
    })),
    hashFile: async (filePath) => hashByteStream(filesystem.openReadStream(await resolveFile(filePath))),
    readFile: async (filePath) => filesystem.readFile(await resolveFile(filePath)),
    writeFile: async ({ filePath, bytes }) => {
      const destination = path.join(vaultPath, filePath);
      await filesystem.mkdir(path.dirname(destination));
      await filesystem.writeFile({ filePath: destination, bytes });
    },
  };
}

export function createVaultStorageInventory(files: VaultStorageFiles) {
  return {
    collect: createStorageInventory(files),
    async materialize(artifacts: readonly BuildArtifact[]) {
      for (const artifact of artifacts) {
        const bytes = await readVerifiedArtifact(artifact);
        // Preserve modification times for unchanged derived artifacts.
        let unchanged = false;
        try {
          const prior = await files.hashFile(artifact.path);
          unchanged = prior.contentHash === artifact.contentHash && prior.size === artifact.size;
        } catch (error: unknown) {
          if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error;
        }
        if (!unchanged) await files.writeFile({ filePath: artifact.path, bytes });
      }
    },
  };
}
