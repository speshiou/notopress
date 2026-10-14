import { describe, expect, it, vi } from 'vitest';
import { createVaultFullSyncHistory } from './full-sync-history';

const target = { endpoint: 'https://storage.example.com', bucket: 'example-bucket', siteId: 'example-site' };

function setup() {
  const files = new Map<string, string>();
  const filesystem = {
    read: async (file: string) => {
      const content = files.get(file);
      if (content === undefined) throw new Error('Missing');
      return content;
    },
    mkdir: vi.fn<(directory: string) => Promise<void>>(async () => undefined),
    write: vi.fn(async ({ file, content }: { file: string; content: string }) => { files.set(file, content); }),
    rename: vi.fn(async ({ source, destination }: { source: string; destination: string }) => {
      const content = files.get(source);
      if (content === undefined) throw new Error('Missing');
      files.set(destination, content);
      files.delete(source);
    }),
    remove: vi.fn(async (file: string) => { files.delete(file); }),
  };
  const create = (vaultPath: string) => createVaultFullSyncHistory({ vaultPath, filesystem,
    now: () => new Date('2026-01-01T00:00:00.000Z'), uniqueId: () => 'example-id',
  });
  return { files, filesystem, create };
}

describe('vault full-sync timestamp file', () => {
  it('reads without creating directories and travels with a copied vault without machine paths', async () => {
    const h = setup();
    await h.create('vault').describe({ target, remind: true });
    expect(h.filesystem.mkdir).not.toHaveBeenCalled();
    expect(h.filesystem.write).not.toHaveBeenCalled();
    await h.create('vault').record({ target });
    const saved = h.files.get('vault/.notopress/full-sync.json');
    expect(saved).toBeDefined();
    expect(saved).not.toContain('vault');
    h.files.set('copied-vault/.notopress/full-sync.json', saved || '');
    expect(await h.create('copied-vault').describe({ target, remind: true })).toContain('2026-01-01');
    expect([...h.files.keys()]).not.toContain('vault/.notopress/full-sync.json.example-id.tmp');
  });

  it('preserves the previous completion record if replacement fails and removes the temporary file', async () => {
    const h = setup();
    await h.create('vault').record({ target });
    const before = h.files.get('vault/.notopress/full-sync.json');
    h.filesystem.rename.mockRejectedValueOnce(new Error('failed'));
    await expect(h.create('vault').record({ target })).rejects.toThrow('failed');
    expect(h.files.get('vault/.notopress/full-sync.json')).toBe(before);
    expect(h.files.size).toBe(1);
  });
});
