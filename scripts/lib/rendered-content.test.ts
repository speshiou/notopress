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
        ['---', 'title: "Post One"', '---', '# Post One', '', 'Before.', '', '![[promo-note]]'].join('\n')
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

      await generateRenderedContent({
        vaultPath,
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
      expect(rendered).not.toContain('![[promo-note]]');
      expect(rendered).not.toContain('<h1>Post One</h1>');
    } finally {
      await rm(vaultPath, { recursive: true, force: true });
    }
  });
});
