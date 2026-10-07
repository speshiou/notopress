import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createWordPressAssetImporter, getWordPressAssetKey, getWordPressAssetScope, type LocalAsset, type WordPressAssetEntry } from './import-assets';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const vaultPath = path.resolve('example-vault');
const source = 'https://wordpress.example.com/uploads/image-640x480.png';
const hosted = 'https://cdn.example.com/example/content/_thumbnails/attachments/image-1200.webp';
const scope = getWordPressAssetScope({ endpoint: 'https://wordpress.example.com/wp-json', hash });

function fixture({ files = new Map<string, Buffer>(), state = {}, bytes = Buffer.from('original image'), folder }: {
  files?: Map<string, Buffer>;
  state?: Record<string, WordPressAssetEntry>;
  bytes?: Buffer;
  folder?: string;
} = {}) {
  const fetchOriginal = vi.fn(async ({ candidates }: { candidates: readonly string[] }) => ({ url: candidates[0] || 'https://wordpress.example.com/uploads/image.png', bytes }));
  const importer = createWordPressAssetImporter({
    vaultPath, siteId: 'example', imageHost: 'https://cdn.example.com', scope, state, folder,
    exists: (file) => files.has(path.relative(vaultPath, file)),
    read: async (file) => {
      const value = files.get(path.relative(vaultPath, file));
      if (!value) throw new Error('Missing fixture');
      return value;
    },
    list: async () => [...files.keys()].map((file): LocalAsset => {
      const [root, ...parts] = file.split(path.sep);
      if (root !== 'content' && root !== 'public') throw new Error('Invalid fixture root');
      return { root, path: parts.join('/') };
    }),
    hash, fetchOriginal,
  });
  return { importer, fetchOriginal, files };
}

describe('WordPress import assets', () => {
  it('reuses the exact original path and ignores an unrelated article image', async () => {
    const { importer, fetchOriginal } = fixture({ files: new Map([
      ['content/attachments/image.png', Buffer.from('original')],
      ['content/example-note/image.webp', Buffer.from('other')],
    ]) });
    expect(importer.resolve({ src: hosted })).toBe('attachments/image.png');
    const [asset] = await importer.prepare();
    expect(asset.path).toBe('attachments/image.png');
    expect(asset.bytes).toBeUndefined();
    expect(fetchOriginal).not.toHaveBeenCalled();
  });

  it('refuses ambiguous source extensions rather than choosing one', () => {
    const { importer } = fixture({ files: new Map([
      ['content/attachments/image.png', Buffer.from('one')],
      ['content/attachments/image.jpg', Buffer.from('two')],
    ]) });
    expect(() => importer.resolve({ src: hosted })).toThrow('Ambiguous');
  });

  it('uses a recorded original to disambiguate extensions', async () => {
    const state = { [getWordPressAssetKey({ scope, source: hosted })]: {
      root: 'content' as const, path: 'attachments/image.jpg', contentHash: hash('two'), originalUrl: 'https://cdn.example.com/example/content/attachments/image.jpg',
    } };
    const { importer } = fixture({ state, files: new Map([
      ['content/attachments/image.png', Buffer.from('one')],
      ['content/attachments/image.jpg', Buffer.from('two')],
    ]) });
    expect(importer.resolve({ src: hosted })).toBe('attachments/image.jpg');
    expect((await importer.prepare())[0].bytes).toBeUndefined();
  });

  it('reuses an Obsidian-added image by content even in another directory', async () => {
    const bytes = Buffer.from('same image');
    const { importer } = fixture({ files: new Map([['content/media/image.png', bytes]]), bytes });
    importer.resolve({ src: source });
    expect((await importer.prepare())[0]).toMatchObject({ path: 'media/image.png', bytes: undefined });
    expect(importer.resolve({ src: source })).toBe('media/image.png');
  });

  it('uses the configured folder and creates no new asset on a subsequent pull', async () => {
    const first = fixture({ folder: 'media' });
    first.importer.resolve({ src: source });
    const [asset] = await first.importer.prepare();
    expect(asset.path).toMatch(/^media\/image-[a-f0-9]{16}\.png$/);
    const state = { [getWordPressAssetKey({ scope, source })]: {
      root: asset.root, path: asset.path, contentHash: asset.contentHash, originalUrl: asset.originalUrl,
    } };
    const next = fixture({ state, folder: 'media', files: new Map([[`content/${asset.path}`, Buffer.from('original image')]]) });
    expect(next.importer.resolve({ src: source })).toBe(asset.path);
    const [reused] = await next.importer.prepare();
    expect(reused.path).toBe(asset.path);
    expect(reused.bytes).toBeUndefined();
  });

  it('deduplicates identical bytes from multiple remote URLs within one import', async () => {
    const { importer } = fixture();
    importer.resolve({ src: source });
    importer.resolve({ src: 'https://wordpress.example.com/uploads/another.png' });
    const assets = await importer.prepare();
    expect(assets[0].path).toBe(assets[1].path);
    expect(assets.filter((asset) => asset.bytes)).toHaveLength(1);
  });

  it('restores a deleted original at its recorded path', async () => {
    const state = { [getWordPressAssetKey({ scope, source: hosted })]: {
      root: 'content' as const, path: 'attachments/image.png', contentHash: hash('original image'), originalUrl: 'https://cdn.example.com/example/content/attachments/image.png',
    } };
    const { importer } = fixture({ state });
    importer.resolve({ src: hosted });
    expect((await importer.prepare())[0]).toMatchObject({ path: 'attachments/image.png', bytes: Buffer.from('original image') });
  });

  it('does not reuse stale mappings when the file was deleted', async () => {
    const state = { [getWordPressAssetKey({ scope, source })]: {
      root: 'content' as const, path: 'assets/image.png', contentHash: hash('original image'), originalUrl: 'https://wordpress.example.com/uploads/image.png',
    } };
    const { importer, fetchOriginal } = fixture({ state });
    importer.resolve({ src: source });
    expect((await importer.prepare())[0].bytes).toBeDefined();
    expect(fetchOriginal).toHaveBeenCalledOnce();
  });

  it('keeps the old asset when remote bytes change at the same URL', async () => {
    const state = { [getWordPressAssetKey({ scope, source })]: {
      root: 'content' as const, path: 'assets/image.png', contentHash: hash('old'), originalUrl: 'https://wordpress.example.com/uploads/image.png',
    } };
    const files = new Map([['content/assets/image.png', Buffer.from('old')]]);
    const { importer } = fixture({ state, files, bytes: Buffer.from('changed') });
    importer.resolve({ src: source });
    const [asset] = await importer.prepare();
    expect(asset.path).not.toBe('assets/image.png');
    expect(files.get('content/assets/image.png')).toEqual(Buffer.from('old'));
  });

  it.each([source, hosted])('rejects local modifications rather than replacing them for %s', async (imageSource) => {
    const state = { [getWordPressAssetKey({ scope, source: imageSource })]: {
      root: 'content' as const, path: 'assets/image.png', contentHash: hash('old'), originalUrl: 'https://wordpress.example.com/uploads/image.png',
    } };
    const { importer, fetchOriginal } = fixture({ state, files: new Map([['content/assets/image.png', Buffer.from('local edit')]]) });
    importer.resolve({ src: imageSource });
    await expect(importer.prepare()).rejects.toThrow('Locally modified');
    expect(fetchOriginal).not.toHaveBeenCalled();
  });

  it('does not deduplicate against generated thumbnails', async () => {
    const { importer } = fixture({ files: new Map([['content/_thumbnails/image-1200.webp', Buffer.from('original image')]]) });
    importer.resolve({ src: source });
    expect((await importer.prepare())[0].path).toMatch(/^assets\//);
  });

  it('rejects unsafe configured folders and encoded traversal paths', () => {
    expect(() => fixture({ folder: '../media' })).toThrow();
    const { importer } = fixture();
    expect(() => importer.resolve({ src: 'https://cdn.example.com/example/content/%2E%2E%2Fsecret.png' })).toThrow('Unsafe');
  });

  it('scopes mappings to the WordPress endpoint', async () => {
    const foreignScope = getWordPressAssetScope({ endpoint: 'https://other.example.com/wp-json', hash });
    const state = { [getWordPressAssetKey({ scope: foreignScope, source })]: {
      root: 'content' as const, path: 'old/image.png', contentHash: hash('original image'), originalUrl: 'https://wordpress.example.com/uploads/image.png',
    } };
    const { importer } = fixture({ state });
    importer.resolve({ src: source });
    expect((await importer.prepare())[0].path).toMatch(/^assets\//);
  });
});
