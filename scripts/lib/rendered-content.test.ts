import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import { generateRenderedContent, getRenderedContentPath } from './rendered-content';
import { VaultDirectoryIndex, VaultRootIndex } from '../../src/lib/vault';

describe('rendered content generator', () => {
  it('generates cached HTML for public content with private note transclusions', async () => {
    const vaultPath = await mkdtemp(path.join(tmpdir(), 'notopress-rendered-'));
    try {
      await mkdir(path.join(vaultPath, 'content'), { recursive: true });
      await mkdir(path.join(vaultPath, 'templates'), { recursive: true });
      await writeFile(
        path.join(vaultPath, 'content', 'post-one.md'),
        [
          '---',
          'title: "Post One"',
          '---',
          '# Post One',
          '',
          'Before.',
          '',
          '![Hero](hero.png)',
          '',
          '![[promo-note]]',
        ].join('\n')
      );
      await writeFile(
        path.join(vaultPath, 'templates', 'promo-note.md'),
        ['---', 'title: "Promo Note"', '---', '# Promo Note', '', 'Private promotion body.'].join('\n')
      );

      const allIndices = new Map<string, VaultDirectoryIndex>([
        [
          '',
          {
            version: 1,
            pages: [{ title: 'Post One', slug: 'post-one', date: '2026-01-01T00:00:00.000Z', excerpt: '' }],
          },
        ],
      ]);
      const rootIndex: VaultRootIndex = {
        version: 1,
        pages: [{ title: 'Post One', slug: 'post-one', date: '2026-01-01T00:00:00.000Z', excerpt: '' }],
        directories: [],
        publicFiles: [],
        assetFiles: [],
        noteIncludes: [
          {
            fullSlug: 'promo-note',
            title: 'Promo Note',
            filePath: 'templates/promo-note.md',
            linkable: false,
          },
        ],
      };

      const renderedResult = await generateRenderedContent({
        vaultPath,
        siteId: 'test-blog',
        allIndices,
        rootIndex,
        thumbnailSizes: [320],
        noteIncludePaths: ['templates'],
        dryRun: false,
        logger: { log: vi.fn() },
      });

      const rendered = await readFile(path.join(vaultPath, getRenderedContentPath({ fullSlug: 'post-one' })), 'utf-8');

      expect(rendered).toContain('Before.');
      expect(rendered).toContain('Private promotion body.');
      expect(rendered).toContain('src="/api/vault-public/_thumbnails/hero-320.webp"');
      expect(rendered).not.toContain('![[promo-note]]');
      expect(rendered).not.toContain('<h1>Post One</h1>');
      expect(renderedResult.artifacts).toEqual([{
        path: '_rendered/content/post-one.html',
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }]);

      const unchangedLogger = { log: vi.fn() };
      await generateRenderedContent({
        vaultPath,
        siteId: 'test-blog',
        allIndices,
        rootIndex,
        thumbnailSizes: [320],
        noteIncludePaths: ['templates'],
        dryRun: true,
        logger: unchangedLogger,
      });

      expect(unchangedLogger.log).toHaveBeenCalledWith('[DRY RUN] 0 of 1 rendered HTML file(s) would change');
      expect(unchangedLogger.log).not.toHaveBeenCalledWith(expect.stringContaining('Would update'));

      await writeFile(path.join(vaultPath, getRenderedContentPath({ fullSlug: 'post-one' })), 'stale HTML');
      const changedLogger = { log: vi.fn() };
      await generateRenderedContent({
        vaultPath,
        siteId: 'test-blog',
        allIndices,
        rootIndex,
        thumbnailSizes: [320],
        noteIncludePaths: ['templates'],
        dryRun: true,
        logger: changedLogger,
      });

      expect(changedLogger.log).toHaveBeenCalledWith(
        '[DRY RUN] Would update rendered HTML: _rendered/content/post-one.html'
      );
      expect(changedLogger.log).toHaveBeenCalledWith('[DRY RUN] 1 of 1 rendered HTML file(s) would change');
      await expect(readFile(path.join(vaultPath, getRenderedContentPath({ fullSlug: 'post-one' })), 'utf-8')).resolves.toBe(
        'stale HTML'
      );
    } finally {
      await rm(vaultPath, { recursive: true, force: true });
    }
  });
});
