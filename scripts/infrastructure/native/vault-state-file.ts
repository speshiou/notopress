import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { NOTOPRESS_DIR } from '../../../src/lib/constants';
export type VaultStateFilesystem = {
  read: (file: string) => Promise<string>;
  mkdir: (directory: string) => Promise<unknown>;
  write: (input: { file: string; content: string }) => Promise<void>;
  rename: (input: { source: string; destination: string }) => Promise<void>;
  remove: (file: string) => Promise<void>;
};

const nativeFilesystem: VaultStateFilesystem = {
  read: (file) => readFile(file, 'utf8'),
  mkdir: (directory) => mkdir(directory, { recursive: true }),
  write: ({ file, content }) => writeFile(file, content, { encoding: 'utf8', mode: 0o600 }),
  rename: ({ source, destination }) => rename(source, destination),
  remove: (file) => rm(file, { force: true }),
};

export function createVaultStateFile({ vaultPath, filename, filesystem = nativeFilesystem, uniqueId = randomUUID }: {
  vaultPath: string;
  filename: string;
  filesystem?: VaultStateFilesystem;
  uniqueId?: () => string;
}) {
  const directory = path.join(vaultPath, NOTOPRESS_DIR);
  const destination = path.join(directory, filename);
  return {
    read: () => filesystem.read(destination),
    write: async (content: string) => {
      await filesystem.mkdir(directory);
      const source = `${destination}.${uniqueId()}.tmp`;
      try {
        await filesystem.write({ file: source, content });
        await filesystem.rename({ source, destination });
      } finally {
        await filesystem.remove(source);
      }
    },
  };
}
