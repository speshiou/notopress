import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createVaultStateFile } from './vault-state-file';
import { NOTOPRESS_DIR } from '../../../src/lib/constants';

describe('atomic local vault state', () => {
  it('keeps the previous complete record and removes temporary files if replacement fails', async () => {
    const vaultPath = await mkdtemp(path.join(tmpdir(), 'notopress-vault-state-'));
    try {
      const file = createVaultStateFile({ vaultPath, filename: 'example.json' });
      await file.write('previous');
      const fs = await import('node:fs/promises');
      const failed = createVaultStateFile({ vaultPath, filename: 'example.json', filesystem: {
        read: (file) => readFile(file, 'utf8'), mkdir: (directory) => fs.mkdir(directory, { recursive: true }),
        write: ({ file, content }) => fs.writeFile(file, content),
        rename: vi.fn<({ source, destination }: { source: string; destination: string }) => Promise<void>>().mockRejectedValue(new Error('interrupted')),
        remove: (file) => rm(file, { force: true }),
      } });
      await expect(failed.write('next')).rejects.toThrow('interrupted');
      expect(await file.read()).toBe('previous');
      expect(await readdir(path.join(vaultPath, NOTOPRESS_DIR))).toEqual(['example.json']);
    } finally { await rm(vaultPath, { recursive: true, force: true }); }
  });
});
