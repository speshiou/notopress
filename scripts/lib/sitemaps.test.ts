import { describe, expect, it, vi } from 'vitest';
import path from 'path';
import { createSitemapGenerator } from './sitemaps';

describe('createSitemapGenerator', () => {
  it('maps index pages to directory URLs', () => {
    const generator = createSitemapGenerator({
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => undefined),
      joinPath: path.posix.join,
      indexSlug: 'page',
      sitemapXml: 'sitemap.xml',
      sitemapPagesXml: 'sitemap_pages.xml',
      logger: { log: vi.fn() },
    });

    expect(
      generator.mapPagesToSitemapUrls({
        domain: 'example.com',
        relDir: 'blog',
        pages: [{ title: 'Blog', slug: 'page', date: '2024-01-01', excerpt: '' }],
      })
    ).toEqual([{ loc: 'https://example.com/blog', lastmod: '2024-01-01' }]);
  });

  it('writes a sitemap index when nested sitemaps exist', async () => {
    const writes: Record<string, string> = {};
    const generator = createSitemapGenerator({
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async (filePath: string, content: string) => {
        writes[filePath] = content;
      }),
      joinPath: path.posix.join,
      indexSlug: 'page',
      sitemapXml: 'sitemap.xml',
      sitemapPagesXml: 'sitemap_pages.xml',
      logger: { log: vi.fn() },
    });

    const allIndices = new Map([
      ['', { version: 1, pages: [] }],
      ['blog', { version: 1, pages: [{ title: 'Post', slug: 'post', date: '2024-01-02', excerpt: '' }] }],
    ]);

    await generator.generateSitemaps({
      vaultPath: 'vault',
      domain: 'example.com',
      rootContentIndex: { version: 1, pages: [{ title: 'Home', slug: 'page', date: '2024-01-01', excerpt: '' }] },
      allIndices,
      dryRun: false,
    });

    expect(writes['vault/public/blog/sitemap.xml']).toContain('https://example.com/blog/post');
    expect(writes['vault/public/sitemap_pages.xml']).toContain('https://example.com/');
    expect(writes['vault/public/sitemap.xml']).toContain('https://example.com/blog/sitemap.xml');
  });
});
