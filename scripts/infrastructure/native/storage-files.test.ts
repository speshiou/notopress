import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, symlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createBuildArtifact } from '../../core/content/build-artifact';
import { createVaultStorageFiles, createDistributionMaterializer } from './storage-files';

describe('vault storage files', () => {
  it('rejects direct file and parent-directory symlinks during bounded asset reads', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'notopress-symlink-'));
    try {
      await mkdir(path.join(root, 'vault'));
      await mkdir(path.join(root, 'outside'));
      await writeFile(path.join(root, 'outside/asset.svg'), 'Source');
      await symlink(path.join(root, 'outside/asset.svg'), path.join(root, 'vault/linked.svg'));
      await symlink(path.join(root, 'outside'), path.join(root, 'vault/linked-directory'));
      const files = createVaultStorageFiles({ vaultPath: path.join(root, 'vault') });
      await expect(files.hashFile('linked.svg')).rejects.toThrow('symbolic links');
      await expect(files.readFile('linked-directory/asset.svg')).rejects.toThrow('symbolic links');
      await expect(files.readFile('../outside/asset.svg')).rejects.toThrow('Invalid vault file');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('materializes prepared outputs only when bytes differ', async () => {
    const vaultPath = await mkdtemp(path.join(tmpdir(), 'notopress-storage-'));
    try {
      await writeFile(path.join(vaultPath, 'root.json'), '{}');
      const files = createVaultStorageFiles({ vaultPath });
      const write = vi.spyOn(files, 'writeFile');
      const materializer = createDistributionMaterializer(files);
      await materializer.materialize([createBuildArtifact({ path: 'root.json', content: '{}' })]);
      expect(write).not.toHaveBeenCalled();
      await materializer.materialize([createBuildArtifact({ path: 'public/sitemap.xml', content: '<xml />' })]);
      expect(write).toHaveBeenCalledOnce();
      expect(await readFile(path.join(vaultPath, 'public/sitemap.xml'), 'utf8')).toBe('<xml />');
    } finally { await rm(vaultPath, { recursive: true, force: true }); }
  });
});
