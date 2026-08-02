import { beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import {
  getWordPressSyncState,
  getWordPressSyncStateFromObject,
  getWordPressSyncEntry,
  isWordPressContentSynced,
  setWordPressEntry,
  updateWordPressSyncState,
  updateWordPressSyncEntries,
} from './wordpress-sync-state';
import { VaultSyncState } from './sync-state';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

describe('wordpress-sync-state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getWordPressSyncStateFromObject', () => {
    it('returns empty object when syncState.wordpress is missing', () => {
      const state: VaultSyncState = {};
      expect(getWordPressSyncStateFromObject(state)).toEqual({});
    });

    it('returns wordpress sync map when present', () => {
      const state: VaultSyncState = {
        wordpress: {
          slug1: { contentHash: 'hash1', syncedAt: '2026-07-29T10:00:00Z' },
        },
      };
      expect(getWordPressSyncStateFromObject(state)).toEqual({
        slug1: { contentHash: 'hash1', syncedAt: '2026-07-29T10:00:00Z' },
      });
    });
  });

  describe('getWordPressSyncState & getWordPressSyncEntry', () => {
    it('returns sync state from file', async () => {
      const mockData = {
        wordpress: {
          'post-a': { contentHash: 'hashA', syncedAt: '2026-07-29T00:00:00Z' },
        },
      };
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockData));

      const state = await getWordPressSyncState({ vaultPath: '/mock/vault' });
      expect(state).toEqual(mockData.wordpress);

      const entry = await getWordPressSyncEntry({ vaultPath: '/mock/vault', slug: 'post-a' });
      expect(entry).toEqual(mockData.wordpress['post-a']);
    });

    it('returns undefined for non-existent entry', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const entry = await getWordPressSyncEntry({ vaultPath: '/mock/vault', slug: 'missing' });
      expect(entry).toBeUndefined();
    });
  });

  describe('isWordPressContentSynced', () => {
    it('returns true when content hash matches', async () => {
      const mockData = {
        wordpress: {
          'post-a': { contentHash: 'hashA', syncedAt: '2026-07-29T00:00:00Z' },
        },
      };
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockData));

      const isSynced = await isWordPressContentSynced({
        vaultPath: '/mock/vault',
        slug: 'post-a',
        contentHash: 'hashA',
      });
      expect(isSynced).toBe(true);
    });

    it('returns false when content hash differs or entry is missing', async () => {
      const mockData = {
        wordpress: {
          'post-a': { contentHash: 'hashA', syncedAt: '2026-07-29T00:00:00Z' },
        },
      };
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockData));

      const isSyncedDiff = await isWordPressContentSynced({
        vaultPath: '/mock/vault',
        slug: 'post-a',
        contentHash: 'hashB',
      });
      expect(isSyncedDiff).toBe(false);

      const isSyncedMissing = await isWordPressContentSynced({
        vaultPath: '/mock/vault',
        slug: 'post-b',
        contentHash: 'hashA',
      });
      expect(isSyncedMissing).toBe(false);
    });
  });

  describe('setWordPressEntry', () => {
    it('initializes wordpress object and sets entry', () => {
      const state: VaultSyncState = {};
      const entry = setWordPressEntry(state, 'test-slug', { contentHash: 'abc' });

      expect(state.wordpress).toBeDefined();
      expect(state.wordpress?.['test-slug']).toBeDefined();
      expect(state.wordpress?.['test-slug'].contentHash).toBe('abc');
      expect(entry.contentHash).toBe('abc');
      expect(entry.syncedAt).toBeDefined();
    });
  });

  describe('updateWordPressSyncState & updateWordPressSyncEntries', () => {
    it('updates a single post entry and writes file', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(writeFile).mockResolvedValue();

      await updateWordPressSyncState({
        vaultPath: '/mock/vault',
        slug: 'single-post',
        contentHash: 'hash123',
        syncedAt: '2026-07-29T12:00:00Z',
      });

      expect(writeFile).toHaveBeenCalledTimes(1);
      const writtenContent = JSON.parse(vi.mocked(writeFile).mock.calls[0][1] as string);
      expect(writtenContent.wordpress['single-post']).toEqual({
        contentHash: 'hash123',
        syncedAt: '2026-07-29T12:00:00Z',
      });
    });

    it('updates batch entries and writes file', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(writeFile).mockResolvedValue();

      await updateWordPressSyncEntries({
        vaultPath: '/mock/vault',
        entries: {
          'post-1': { contentHash: 'h1' },
          'post-2': { contentHash: 'h2' },
        },
      });

      expect(writeFile).toHaveBeenCalledTimes(1);
      const writtenContent = JSON.parse(vi.mocked(writeFile).mock.calls[0][1] as string);
      expect(writtenContent.wordpress['post-1'].contentHash).toBe('h1');
      expect(writtenContent.wordpress['post-2'].contentHash).toBe('h2');
    });
  });
});
