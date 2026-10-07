import * as io from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderMarkdownContent } from '../../../src/lib/markdown';
import { getThumbnailPath } from '../../../src/lib/responsive-images';
import { SYNC_STATE_FILENAME } from '../../core/state/sync-state';
import { importFromWordPress } from './wordpress';

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) await io.rm(dir, { recursive: true, force: true });
});

async function fixture({ remote = false, alt = 'Image' }: { remote?: boolean; alt?: string } = {}) {
  const vaultPath = await io.mkdtemp(path.join(os.tmpdir(), 'example-round-trip-'));
  directories.push(vaultPath);
  await io.mkdir(path.join(vaultPath, 'content', 'attachments'), { recursive: true });
  await io.mkdir(path.join(vaultPath, 'content', 'example-note'), { recursive: true });
  const originalPath = path.join(vaultPath, 'content', 'attachments', 'image.png');
  const otherPath = path.join(vaultPath, 'content', 'example-note', 'image.webp');
  const originalBytes = Buffer.from('original image bytes');
  const otherBytes = Buffer.from('unrelated image bytes');
  await io.writeFile(originalPath, originalBytes);
  await io.writeFile(otherPath, otherBytes);
  const markdown = `![${alt}](<attachments/image.png>)`;
  const assetPath = 'attachments/image.png';
  const rendered = remote ? '<p><img src="https://wordpress.example.com/uploads/image-640x480.png" alt="Image"></p>'
    : await renderMarkdownContent({
      markdown, thumbnailSizes: [1200], assetFiles: [assetPath],
      assetUrlConfig: { imageHost: 'https://cdn.example.com', siteId: 'example', s3SubDir: 'content', mode: 'absolute' },
    });
  const originalArticle = `---\ntitle: "Example Note"\ndate: "2026-01-01T00:00:00.000Z"\nupdated: "2026-01-01T00:00:00.000Z"\n---\n${markdown}\n`;
  const articlePath = path.join(vaultPath, 'content', 'example-note.md');
  await io.writeFile(articlePath, originalArticle);
  const fetch = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
    const url = String(input);
    if (options?.method && options.method !== 'GET') throw new Error('Remote mutation attempted');
    if (url.includes('/wp/v2/posts?')) return Response.json([{
      id: 10, slug: 'example-note', status: 'publish', date: '2026-01-01T00:00:00', date_gmt: '2026-01-01T00:00:00',
      modified: '2026-01-01T00:00:00', modified_gmt: '2026-01-01T00:00:00', title: { rendered: 'Example Note' }, content: { rendered },
    }]);
    if (url.includes('/wp/v2/media?')) return Response.json([{
      source_url: 'https://wordpress.example.com/uploads/image.png',
      media_details: { sizes: { medium: { source_url: 'https://wordpress.example.com/uploads/image-640x480.png' } } },
    }]);
    if (url === 'https://cdn.example.com/example/content/attachments/image.png'
      || url === 'https://wordpress.example.com/uploads/image.png') return new Response(originalBytes, { headers: { 'content-type': 'image/png' } });
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal('fetch', fetch);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const site = {
    siteId: 'example', vaultPath, imageHost: 'https://cdn.example.com',
    wordpress: { endpoint: 'https://wordpress.example.com/wp-json', username: 'editor', applicationPassword: 'example-password', assetFolder: 'assets' },
  };
  const pull = (dryRun = false) => importFromWordPress({ site, registry: { sites: [site] }, slugOrId: 'example-note', dryRun });
  return { site, pull, vaultPath, articlePath, originalPath, originalBytes, originalArticle, otherPath, otherBytes, fetch, assetPath };
}

describe('WordPress import round trips', () => {
  it('pulls grouped articles in place and preserves relative image paths on repeated imports', async () => {
    const f = await fixture();
    const site = { ...f.site, rewrites: [{ source: 'guides/:group/:path*', destination: '/:path*' }] };
    const articlePath = path.join(f.vaultPath, 'content', 'guides', 'edition-a', 'example-note.md');
    await io.mkdir(path.dirname(articlePath), { recursive: true });
    await io.rename(f.articlePath, articlePath);
    await io.writeFile(articlePath, f.originalArticle.replace('attachments/image.png', '../../attachments/image.png'));
    for (let i = 0; i < 2; i++) await importFromWordPress({ site, registry: { sites: [site] }, slugOrId: 'example-note', dryRun: false });
    expect(await io.readFile(articlePath, 'utf-8')).toBe(f.originalArticle.replace('attachments/image.png', '../../attachments/image.png'));
    await expect(io.access(f.articlePath)).rejects.toThrow();
    expect(await io.readFile(f.originalPath)).toEqual(f.originalBytes);
  });
  it('preserves legacy paths and bytes across repeated pulls and restores a deleted original', async () => {
    const f = await fixture();
    await f.pull();
    await f.pull();
    expect(await io.readFile(f.articlePath, 'utf-8')).toBe(f.originalArticle);
    expect(await io.readFile(f.originalPath)).toEqual(f.originalBytes);
    expect(await io.readFile(f.otherPath)).toEqual(f.otherBytes);
    await expect(io.access(path.join(f.vaultPath, 'content', 'assets'))).rejects.toThrow();
    await io.unlink(f.originalPath);
    await f.pull();
    expect(await io.readFile(f.originalPath)).toEqual(f.originalBytes);
    expect(await io.readFile(f.articlePath, 'utf-8')).toBe(f.originalArticle);
    expect(await io.readdir(path.dirname(f.originalPath))).toEqual(['image.png']);
    expect(f.fetch.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
    expect(getThumbnailPath({ imagePath: f.assetPath, width: 1200 })).toBe('_thumbnails/attachments/image-1200.webp');
  });

  it('reuses an existing original by content for WordPress media without moving it', async () => {
    const f = await fixture({ remote: true });
    await f.pull();
    await f.pull();
    expect(await io.readFile(f.articlePath, 'utf-8')).toBe(f.originalArticle);
    expect(await io.readFile(f.originalPath)).toEqual(f.originalBytes);
    await expect(io.access(path.join(f.vaultPath, 'content', 'assets'))).rejects.toThrow();
  });

  it('places genuinely new originals in assets and adds no duplicates on repeated pulls', async () => {
    const f = await fixture({ remote: true });
    await io.unlink(f.originalPath);
    await f.pull();
    const assetDirectory = path.join(f.vaultPath, 'content', 'assets');
    const first = await io.readdir(assetDirectory);
    expect(first).toHaveLength(1);
    await f.pull();
    expect(await io.readdir(assetDirectory)).toEqual(first);
    expect(await io.readFile(path.join(assetDirectory, first[0]))).toEqual(f.originalBytes);
    expect(await io.readFile(f.otherPath)).toEqual(f.otherBytes);
  });

  it('keeps dry runs read-only, including Markdown, mappings and assets', async () => {
    const f = await fixture({ remote: true });
    await io.unlink(f.originalPath);
    await f.pull(true);
    expect(await io.readFile(f.articlePath, 'utf-8')).toBe(f.originalArticle);
    await expect(io.access(path.join(f.vaultPath, 'content', 'assets'))).rejects.toThrow();
    await expect(io.access(path.join(f.vaultPath, SYNC_STATE_FILENAME))).rejects.toThrow();
    expect(await io.readdir(f.vaultPath)).toEqual(['content']);
  });

  it('keeps local content intact when original-image fetching fails', async () => {
    const f = await fixture();
    await io.unlink(f.originalPath);
    const originalFetch = f.fetch.getMockImplementation();
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
      if (String(input).includes('cdn.example.com')) return new Response(null, { status: 404 });
      if (!originalFetch) throw new Error('Missing fixture fetch');
      return originalFetch(input, options);
    }));
    await expect(f.pull()).rejects.toThrow('Original image is unavailable');
    expect(await io.readFile(f.articlePath, 'utf-8')).toBe(f.originalArticle);
    expect(await io.readFile(f.otherPath)).toEqual(f.otherBytes);
    await expect(io.access(path.join(f.vaultPath, SYNC_STATE_FILENAME))).rejects.toThrow();
  });
  it('preserves encoded alt text without importing a generated duplicate caption', async () => {
    const f = await fixture({ alt: 'Example & illustration' });
    await f.pull();
    expect(await io.readFile(f.articlePath, 'utf-8')).toBe(f.originalArticle);
  });

  it('changing the asset folder policy leaves existing paths intact', async () => {
    const f = await fixture();
    f.site.wordpress.assetFolder = 'media/images';
    await f.pull();
    expect(await io.readFile(f.articlePath, 'utf-8')).toBe(f.originalArticle);
    expect(await io.readFile(f.originalPath)).toEqual(f.originalBytes);
    await expect(io.access(path.join(f.vaultPath, 'content', 'media'))).rejects.toThrow();
  });

});
