import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createBuildArtifact } from '../../core/content/build-artifact';
import { createVaultStorageFiles, createVaultStorageInventory } from './vault-inventory';

describe('vault storage files', () => {
  it('materializes prepared outputs only when bytes differ', async () => {
    const vaultPath = await mkdtemp(path.join(tmpdir(), 'notopress-storage-'));
    try {
      await writeFile(path.join(vaultPath, 'root.json'), '{}');
      const files = createVaultStorageFiles({ vaultPath });
      const write = vi.spyOn(files, 'writeFile');
      const inventory = createVaultStorageInventory(files);
      await inventory.materialize([createBuildArtifact({ path: 'root.json', content: '{}' })]);
      expect(write).not.toHaveBeenCalled();
      await inventory.materialize([createBuildArtifact({ path: 'public/sitemap.xml', content: '<xml />' })]);
      expect(write).toHaveBeenCalledOnce();
      expect(await readFile(path.join(vaultPath, 'public/sitemap.xml'), 'utf8')).toBe('<xml />');
    } finally { await rm(vaultPath, { recursive: true, force: true }); }
  });
});
