import { describe, expect, it, vi } from 'vitest';
import path from 'path';
import { computeContentHash, createSyncStateManager } from './sync-state';

describe('sync-state core', () => {
  describe('computeContentHash', () => {
    it('computes deterministic SHA-256 hashes for content', () => {
      const content = '# Hello World\n\nThis is a test post.';
      const hash1 = computeContentHash(content);
      const hash2 = computeContentHash(content);

      expect(hash1).toEqual(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('produces different hashes for modified content', () => {
      const hash1 = computeContentHash('# Hello World');
      const hash2 = computeContentHash('# Hello World Modified');

      expect(hash1).not.toEqual(hash2);
    });
  });

  describe('createSyncStateManager', () => {
    it('returns empty sync state when file does not exist', async () => {
      const manager = createSyncStateManager({
        exists: vi.fn(async () => false),
        readFile: vi.fn(async () => ''),
        writeFile: vi.fn(async () => undefined),
        joinPath: path.posix.join,
      });

      const state = await manager.loadSyncState({ vaultPath: '/vault' });
      expect(state).toEqual({});
    });

    it('loads existing sync state from disk', async () => {
      const mockState = {
        wordpress: {
          'post-one': {
            contentHash: 'abc123hash',
            syncedAt: '2026-07-27T12:00:00.000Z',
          },
        },
      };

      const manager = createSyncStateManager({
        exists: vi.fn(async () => true),
        readFile: vi.fn(async () => JSON.stringify(mockState)),
        writeFile: vi.fn(async () => undefined),
        joinPath: path.posix.join,
      });

      const state = await manager.loadSyncState({ vaultPath: '/vault' });
      expect(state).toEqual(mockState);
    });

    it('saves sync state to disk', async () => {
      const writes: Record<string, string> = {};
      const manager = createSyncStateManager({
        exists: vi.fn(async () => false),
        readFile: vi.fn(async () => ''),
        writeFile: vi.fn(async (filePath, content) => {
          writes[filePath] = content;
        }),
        joinPath: path.posix.join,
      });

      const nextState = {
        wordpress: {
          'blog/post-two': {
            contentHash: 'def456hash',
            syncedAt: '2026-07-27T14:00:00.000Z',
          },
        },
      };

      await manager.saveSyncState({ vaultPath: '/vault', syncState: nextState });

      expect(writes['/vault/.notopress-sync.json']).toBeDefined();
      expect(JSON.parse(writes['/vault/.notopress-sync.json'])).toEqual(nextState);
    });

    it('manages generic sync sections', async () => {
      const writes: Record<string, string> = {};
      const manager = createSyncStateManager({
        exists: vi.fn(async () => false),
        readFile: vi.fn(async () => ''),
        writeFile: vi.fn(async (filePath, content) => {
          writes[filePath] = content;
        }),
        joinPath: path.posix.join,
      });

      await manager.updateSyncStateSection({
        vaultPath: '/vault',
        sectionKey: 'ghost',
        updater: (section: Record<string, { id: string }>) => {
          section['post-1'] = { id: 'ghost_123' };
        },
      });

      const saved = JSON.parse(writes['/vault/.notopress-sync.json']);
      expect(saved.ghost).toEqual({ 'post-1': { id: 'ghost_123' } });

      const ghostSection = manager.getSyncSection(saved, 'ghost');
      expect(ghostSection).toEqual({ 'post-1': { id: 'ghost_123' } });
    });
  });
});
