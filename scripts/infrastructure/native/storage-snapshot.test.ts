import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, stat, utimes, access, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createBuildArtifact } from '../../core/content/build-artifact';
import { createStorageSnapshot } from './storage-snapshot';

describe('AWS CLI prepared filesystem snapshot', () => {
  it('freezes source bytes, includes missing generated files, preserves unchanged timestamps, and cleans temporary state', async () => {
    const vault = await mkdtemp(path.join(tmpdir(), 'notopress-snapshot-test-'));
    try {
      await mkdir(path.join(vault, 'content'));
      const sourcePath = path.join(vault, 'content/article.md');
      await writeFile(sourcePath, 'body');
      await utimes(sourcePath, new Date('2026-01-01'), new Date('2026-01-01'));
      await writeFile(path.join(vault, 'root.json'), 'old');
      await chmod(path.join(vault, 'root.json'), 0o444);
      const artifacts = [
        { ...createBuildArtifact({ path: 'content/article.md', content: 'body', read: () => readFile(sourcePath) }), key: 'example-site/content/article.md' },
        { ...createBuildArtifact({ path: 'root.json', content: '{}' }), key: 'example-site/root.json' },
        { ...createBuildArtifact({ path: 'registry.json', content: '{"sites":[]}' }), key: 'registry.json' },
      ];
      const prepared = await createStorageSnapshot({ vaultPath: vault, artifacts });
      try {
        expect(await readFile(path.join(prepared.snapshotPath, 'root.json'), 'utf8')).toBe('{}');
        expect(await readFile(path.join(vault, 'root.json'), 'utf8')).toBe('old');
        expect((await stat(path.join(prepared.snapshotPath, 'content/article.md'))).mtimeMs).toBe((await stat(sourcePath)).mtimeMs);
        expect(await readFile(prepared.configPath, 'utf8')).toContain('preferred_transfer_client = classic');
        await writeFile(sourcePath, 'EDIT');
        expect(await readFile(path.join(prepared.snapshotPath, 'content/article.md'), 'utf8')).toBe('body');
        await prepared.verify();
        await writeFile(path.join(prepared.snapshotPath, 'content/article.md'), 'EDIT');
        await expect(prepared.verify()).rejects.toThrow('Prepared artifact changed');
      } finally { await prepared.close(); }
      await expect(access(prepared.snapshotPath)).rejects.toThrow();
      await expect(createStorageSnapshot({ vaultPath: vault, artifacts })).rejects.toThrow('Prepared artifact changed');
    } finally { await rm(vault, { recursive: true, force: true }); }
  });
});
