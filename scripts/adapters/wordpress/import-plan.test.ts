import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createWordPressImportPlan, createWordPressImportApplier } from './import-plan';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const bytes = Buffer.from('original');
const asset = { source: 'https://example.com/image.png', root: 'content' as const, path: 'assets/image.png', originalUrl: 'https://example.com/image.png', contentHash: hash(bytes), bytes };
const plan = () => createWordPressImportPlan({ scope: 'example', previousStateHash: null, assetFolder: 'assets', assets: [asset], path: 'content/example-note.md', markdown: '![Image](assets/image.png)', previousHash: 'original article' });

describe('WordPress import plan', () => {
  it('fingerprints content and asset identity without serializing binary data', () => {
    expect(plan().fingerprint).toBe(plan().fingerprint);
    expect(createWordPressImportPlan({ scope: 'example', previousStateHash: null, assetFolder: 'assets', assets: [asset], path: 'content/example-note.md', markdown: 'changed', previousHash: 'original article' }).fingerprint).not.toBe(plan().fingerprint);
  });

  it('commits only after all required asset writes succeed', async () => {
    const commit = vi.fn();
    const apply = createWordPressImportApplier({
      getHash: async (file) => file.endsWith('.md') ? 'original article' : null,
      hash, assetPath: (value) => value.path, assetKey: (source) => source,
      writeAsset: async () => { throw new Error('Disk failure'); }, commit,
    });
    await expect(apply({ plan: plan() })).rejects.toThrow('Disk failure');
    expect(commit).not.toHaveBeenCalled();
  });

  it('rejects changed local articles and images before writing', async () => {
    const writeAsset = vi.fn();
    const commit = vi.fn();
    const apply = createWordPressImportApplier({
      getHash: async (file) => file.endsWith('.md') ? 'original article' : 'local edit',
      hash, assetPath: (value) => value.path, assetKey: (source) => source, writeAsset, commit,
    });
    await expect(apply({ plan: plan() })).rejects.toThrow('Local image changed');
    expect(writeAsset).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('rejects missing reused files before committing broken references', async () => {
    const commit = vi.fn();
    const apply = createWordPressImportApplier({
      getHash: async (file) => file.endsWith('.md') ? 'original article' : null,
      hash, assetPath: (value) => value.path, assetKey: (source) => source, writeAsset: vi.fn(), commit,
    });
    const reusePlan = createWordPressImportPlan({ scope: 'example', previousStateHash: null, assetFolder: 'assets', assets: [{ ...asset, bytes: undefined }], path: 'content/example-note.md', markdown: 'body', previousHash: 'original article' });
    await expect(apply({ plan: reusePlan })).rejects.toThrow('disappeared');
    expect(commit).not.toHaveBeenCalled();
  });
  it('applies a shared pending asset once for multiple source references', async () => {
    const writeAsset = vi.fn();
    const commit = vi.fn();
    const apply = createWordPressImportApplier({
      getHash: async (file) => file.endsWith('.md') ? 'original article' : null,
      hash, assetPath: (value) => value.path, assetKey: (source) => source, writeAsset, commit,
    });
    const sharedPlan = createWordPressImportPlan({
      scope: 'example', previousStateHash: null, assetFolder: 'assets',
      assets: [asset, { ...asset, source: 'https://example.com/shared.png', bytes: undefined }],
      path: 'content/example-note.md', markdown: 'body', previousHash: 'original article',
    });
    await apply({ plan: sharedPlan });
    expect(writeAsset).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledOnce();
  });

});
