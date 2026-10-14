import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createStorageInventory, type InventoryFile } from '../../core/storage/inventory';
import { readVerifiedArtifact, type BuildArtifact } from '../../core/content/build-artifact';
import { hashByteStream } from './hash-stream';

export type VaultStorageFiles = {
  listDirectory: (directory: string) => Promise<readonly InventoryFile[]>;
  hashFile: (filePath: string) => Promise<{ size: number; contentHash: string }>;
  readFile: (filePath: string) => Promise<Uint8Array>;
  writeFile: (input: { filePath: string; bytes: Uint8Array }) => Promise<void>;
};

type NativeVaultFilesystem = {
  readdir: (directory: string) => Promise<readonly { name: string; isDirectory: () => boolean; isFile: () => boolean }[]>;
  openReadStream: (filePath: string) => AsyncIterable<unknown>;
  readFile: (filePath: string) => Promise<Uint8Array>;
  mkdir: (directory: string) => Promise<unknown>;
  writeFile: (input: { filePath: string; bytes: Uint8Array }) => Promise<void>;
};

const nativeFilesystem: NativeVaultFilesystem = {
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
  return {
    listDirectory: async (directory) => (await filesystem.readdir(path.join(vaultPath, directory))).map((entry) => ({
      path: entry.name, kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'unsupported',
    })),
    hashFile: (filePath) => hashByteStream(filesystem.openReadStream(path.join(vaultPath, filePath))),
    readFile: (filePath) => filesystem.readFile(path.join(vaultPath, filePath)),
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
