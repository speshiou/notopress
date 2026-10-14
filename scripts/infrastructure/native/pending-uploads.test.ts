import { describe, expect, it, vi } from 'vitest';
import { readPendingStorageKeys } from './pending-uploads';

describe('pending upload file reader', () => {
  it('supports an optional file and rejects unreadable or malformed supplied files', async () => {
    const readText = vi.fn(async () => '["example-site/content/article.md"]');
    expect(await readPendingStorageKeys({ readText })).toEqual([]);
    expect(readText).not.toHaveBeenCalled();
    expect(await readPendingStorageKeys({ filePath: 'pending.json', readText })).toEqual(['example-site/content/article.md']);
    await expect(readPendingStorageKeys({ filePath: 'pending.json', readText: async () => { throw new Error('private diagnostic'); } })).rejects.toThrow('Could not read pending uploads file');
    await expect(readPendingStorageKeys({ filePath: 'pending.json', readText: async () => '{}' })).rejects.toThrow('JSON array');
  });
});
