import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { NOTOPRESS_DIR } from '../../../src/lib/constants';
import { createFullSyncHistory, FULL_SYNC_HISTORY_FILENAME } from '../../core/storage/full-sync-history';

type HistoryFilesystem = {
  read: (file: string) => Promise<string>;
  mkdir: (directory: string) => Promise<unknown>;
  write: (input: { file: string; content: string }) => Promise<void>;
  rename: (input: { source: string; destination: string }) => Promise<void>;
  remove: (file: string) => Promise<void>;
};

const nativeFilesystem: HistoryFilesystem = {
  read: (file) => readFile(file, 'utf8'),
  mkdir: (directory) => mkdir(directory, { recursive: true }),
  write: ({ file, content }) => writeFile(file, content, { encoding: 'utf8', mode: 0o600 }),
  rename: ({ source, destination }) => rename(source, destination),
  remove: (file) => rm(file, { force: true }),
};

export function createVaultFullSyncHistory({ vaultPath, filesystem = nativeFilesystem, now = () => new Date(), uniqueId = randomUUID }: {
  vaultPath: string;
  filesystem?: HistoryFilesystem;
  now?: () => Date;
  uniqueId?: () => string;
}) {
  const directory = path.join(vaultPath, NOTOPRESS_DIR);
  const destination = path.join(directory, FULL_SYNC_HISTORY_FILENAME);
  return createFullSyncHistory({
    now,
    read: () => filesystem.read(destination),
    write: async (content) => {
      await filesystem.mkdir(directory);
      const source = `${destination}.${uniqueId()}.tmp`;
      try {
        await filesystem.write({ file: source, content });
        await filesystem.rename({ source, destination });
      } finally {
        await filesystem.remove(source);
      }
    },
  });
}
