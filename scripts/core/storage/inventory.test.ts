import { describe, expect, it, vi } from 'vitest';
import { createBuildArtifact } from '../content/build-artifact';
import { assertInventorySourceHashes, createStorageInventory, type InventoryFile } from './inventory';

describe('expected vault storage inventory', () => {
  it('rejects source changes between canonical rendering and inventory discovery', () => {
    const source = createBuildArtifact({ path: 'content/article.md', content: 'body' });
    const changed = createBuildArtifact({ path: source.path, content: 'edit' });
    expect(() => assertInventorySourceHashes({ artifacts: [changed], sources: [source] })).toThrow('Build source changed during preparation');
    expect(() => assertInventorySourceHashes({ artifacts: [source], sources: [source] })).not.toThrow();
  });
  it('covers all source files and overlays generated outputs without reading stale artifacts or caches', async () => {
    const tree: Record<string, InventoryFile[]> = {
      '': [{ path: 'content', kind: 'directory' }, { path: '.notopress', kind: 'directory' }, { path: 'root.json', kind: 'file' }],
      content: [{ path: 'article.md', kind: 'file' }, { path: 'hero.png', kind: 'file' }, { path: 'index.json', kind: 'file' }],
    };
    const hashFile = vi.fn(async () => ({ size: 4, contentHash: 'a'.repeat(64) }));
    const collect = createStorageInventory({
      listDirectory: async (path) => tree[path] || [], hashFile, readFile: async () => Buffer.from('body'),
    });
    const generated = createBuildArtifact({ path: 'root.json', content: 'new root' });
    const result = await collect({ generatedArtifacts: [generated] });
    expect(result.map((entry) => entry.path)).toEqual(['content/article.md', 'content/hero.png', 'root.json']);
    expect(result[2]).toBe(generated);
    expect(hashFile.mock.calls).toEqual([['content/article.md'], ['content/hero.png']]);
  });
  it('rejects duplicate outputs and unsupported entries instead of following symbolic links', async () => {
    const collect = createStorageInventory({
      listDirectory: async () => [{ path: 'link', kind: 'unsupported' }],
      hashFile: async () => ({ size: 0, contentHash: 'a'.repeat(64) }), readFile: async () => new Uint8Array(),
    });
    const output = createBuildArtifact({ path: 'root.json', content: '{}' });
    await expect(collect({ generatedArtifacts: [output, output] })).rejects.toThrow('duplicate generated');
    await expect(collect({ generatedArtifacts: [] })).rejects.toThrow('Unsupported storage entry');
  });
});
