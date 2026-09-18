import { beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import {
  getWordPressPublicationState,
  getWordPressPublicationStateFromObject,
  getWordPressPublicationStateEntry,
  isWordPressPayloadPublished,
  setWordPressPublicationStateEntry,
  updateWordPressPublicationState,
  updateWordPressPublicationStateEntries,
} from './publication-state';
import { VaultSyncState } from '../../core/state/sync-state';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

describe('wordpress publication state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getWordPressPublicationStateFromObject', () => {
    it('returns empty object when syncState.wordpress is missing', () => {
      const state: VaultSyncState = {};
      expect(getWordPressPublicationStateFromObject(state)).toEqual({});
    });

    it('returns wordpress sync map when present', () => {
      const state: VaultSyncState = {
        wordpress: {
          slug1: { contentHash: 'hash1', syncedAt: '2026-07-29T10:00:00Z' },
        },
      };
      expect(getWordPressPublicationStateFromObject(state)).toEqual({
        slug1: { contentHash: 'hash1', syncedAt: '2026-07-29T10:00:00Z' },
      });
    });
  });

  describe('getWordPressPublicationState and getWordPressPublicationStateEntry', () => {
    it('returns sync state from file', async () => {
      const mockData = {
        wordpress: {
          'post-a': { contentHash: 'hashA', syncedAt: '2026-07-29T00:00:00Z' },
        },
      };
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockData));

      const state = await getWordPressPublicationState({ vaultPath: '/mock/vault' });
      expect(state).toEqual(mockData.wordpress);

      const entry = await getWordPressPublicationStateEntry({ vaultPath: '/mock/vault', slug: 'post-a' });
      expect(entry).toEqual(mockData.wordpress['post-a']);
    });

    it('returns undefined for non-existent entry', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const entry = await getWordPressPublicationStateEntry({ vaultPath: '/mock/vault', slug: 'missing' });
      expect(entry).toBeUndefined();
    });
  });

  describe('isWordPressPayloadPublished', () => {
    it('returns true when payload hash matches', async () => {
      const mockData = {
        wordpress: {
          'post-a': { contentHash: 'sourceA', payloadHash: 'payloadA', syncedAt: '2026-07-29T00:00:00Z' },
        },
      };
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockData));

      const isPublished = await isWordPressPayloadPublished({
        vaultPath: '/mock/vault',
        slug: 'post-a',
        payloadHash: 'payloadA',
      });
      expect(isPublished).toBe(true);
    });

    it('returns false when payload hash differs or entry is missing', async () => {
      const mockData = {
        wordpress: {
          'post-a': { contentHash: 'sourceA', payloadHash: 'payloadA', syncedAt: '2026-07-29T00:00:00Z' },
        },
      };
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockData));

      const isPublishedWithDifferentPayload = await isWordPressPayloadPublished({
        vaultPath: '/mock/vault',
        slug: 'post-a',
        payloadHash: 'payloadB',
      });
      expect(isPublishedWithDifferentPayload).toBe(false);

      const isPublishedWhenMissing = await isWordPressPayloadPublished({
        vaultPath: '/mock/vault',
        slug: 'post-b',
        payloadHash: 'payloadA',
      });
      expect(isPublishedWhenMissing).toBe(false);
    });
  });

  describe('setWordPressPublicationStateEntry', () => {
    it('initializes wordpress object and sets entry', () => {
      const state: VaultSyncState = {};
      const entry = setWordPressPublicationStateEntry(state, 'test-slug', {
        contentHash: 'abc',
        payloadHash: 'payload-abc',
        remoteId: 123,
        remoteSlug: 'test-slug',
        contentType: 'post',
      });
      const wordpressState = getWordPressPublicationStateFromObject(state);

      expect(state.wordpress).toBeDefined();
      expect(wordpressState['test-slug']).toBeDefined();
      expect(wordpressState['test-slug'].contentHash).toBe('abc');
      expect(wordpressState['test-slug'].payloadHash).toBe('payload-abc');
      expect(wordpressState['test-slug'].remoteId).toBe(123);
      expect(wordpressState['test-slug'].remoteSlug).toBe('test-slug');
      expect(wordpressState['test-slug'].contentType).toBe('post');
      expect(entry.contentHash).toBe('abc');
      expect(entry.payloadHash).toBe('payload-abc');
      expect(entry.syncedAt).toBeDefined();
    });
  });

  describe('updateWordPressPublicationState and updateWordPressPublicationStateEntries', () => {
    it('updates a single post entry and writes file', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(writeFile).mockResolvedValue();

      await updateWordPressPublicationState({
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

      await updateWordPressPublicationStateEntries({
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
