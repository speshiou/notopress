import crypto from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

export const SYNC_STATE_FILENAME = '.notopress-sync.json';

export interface WordPressSyncEntry {
  contentHash: string;
  syncedAt: string;
}

export interface VaultSyncState {
  wordpress?: Record<string, WordPressSyncEntry>;
}

export type SyncStateDeps = {
  exists: (path: string) => Promise<boolean>;
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  joinPath: (...paths: string[]) => string;
};

export function computeContentHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

export function createSyncStateManager(deps: SyncStateDeps) {
  return {
    async loadSyncState({ vaultPath }: { vaultPath: string }): Promise<VaultSyncState> {
      const statePath = deps.joinPath(vaultPath, SYNC_STATE_FILENAME);
      if (!(await deps.exists(statePath))) {
        return {};
      }
      try {
        const raw = await deps.readFile(statePath, 'utf-8');
        return JSON.parse(raw) as VaultSyncState;
      } catch {
        return {};
      }
    },

    async saveSyncState({
      vaultPath,
      syncState,
    }: {
      vaultPath: string;
      syncState: VaultSyncState;
    }): Promise<void> {
      const statePath = deps.joinPath(vaultPath, SYNC_STATE_FILENAME);
      const jsonContent = JSON.stringify(syncState, null, 2) + '\n';
      await deps.writeFile(statePath, jsonContent);
    },
  };
}

const defaultSyncStateManager = createSyncStateManager({
  exists: async (p) => existsSync(p),
  readFile: async (p, encoding) => readFile(p, encoding),
  writeFile: async (p, content) => writeFile(p, content, 'utf-8'),
  joinPath: path.join,
});

export const loadSyncState = defaultSyncStateManager.loadSyncState;
export const saveSyncState = defaultSyncStateManager.saveSyncState;
