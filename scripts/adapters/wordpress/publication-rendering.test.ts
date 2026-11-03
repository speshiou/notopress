import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Site } from '../../../src/domain/registry';
import type { VaultDirectoryIndex, VaultRootIndex } from '../../../src/lib/vault';
import { prepareWordPressPublication } from './wordpress';
import { getWordPressPublicationState } from './publication-state';

describe('WordPress rendered publication comparison', () => {
  it.each(['image host', 'image widths', 'transclusion', 'source metadata'] as const)(
    'compares the final payload after a change to %s', async (change) => {
      const vaultPath = await mkdtemp(path.join(tmpdir(), 'notopress-publication-rendering-'));
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const request = vi.fn<typeof fetch>(async () => new Response('[]'));
      vi.stubGlobal('fetch', request);
      try {
        await mkdir(path.join(vaultPath, 'content/guides'), { recursive: true });
        await mkdir(path.join(vaultPath, '_includes'));
        const articlePath = path.join(vaultPath, 'content/guides/article.md');
        const source = '---\ntitle: Article\n---\n![Logo](logo.png)\n\n![[note]]';
        await writeFile(articlePath, source);
        await writeFile(path.join(vaultPath, '_includes/note.md'), '# Note\n\nIncluded body.');
        const site: Site = {
          siteId: 'example-site', vaultPath, domain: 'example.com',
          imageHost: 'https://cdn.example.com', thumbnailSizes: [320, 640], noteIncludePaths: ['_includes'],
          wordpress: { endpoint: 'https://wordpress.example.com/wp-json', username: 'editor', applicationPassword: 'example-password' },
        };
        const allIndices = new Map<string, VaultDirectoryIndex>([['guides', {
          version: 1, pages: [{ title: 'Article', slug: 'article', date: '2026-01-01', excerpt: '' }],
        }]]);
        const rootIndex: VaultRootIndex = {
          version: 1, pages: [], directories: ['guides'], publicFiles: [],
          assetFiles: ['logo.png', 'guides/logo.png'],
          responsiveImageWidths: { 'logo.png': [640], 'guides/logo.png': [320] },
        };
        const input = { site, registry: { sites: [site] }, allIndices, rootIndex, dryRun: true };
        await prepareWordPressPublication({ ...input, initializeState: true, dryRun: false });
        const before = await getWordPressPublicationState({ vaultPath });
        const unchanged = await prepareWordPressPublication(input);
        expect(unchanged?.plan.operations[0].action).toBe('skip');
        expect(request).not.toHaveBeenCalled();

        switch (change) {
          case 'image host': site.imageHost = 'https://media.example.com'; break;
          case 'image widths': rootIndex.responsiveImageWidths = { 'logo.png': [640], 'guides/logo.png': [640] }; break;
          case 'transclusion': await writeFile(path.join(vaultPath, '_includes/note.md'), '# Note\n\nUpdated include.'); break;
          case 'source metadata': await writeFile(articlePath, source.replace('title: Article', 'title: Article\neditor_note: revised')); break;
        }
        const changedSource = await readFile(articlePath, 'utf8');
        const changed = await prepareWordPressPublication(input);
        const operation = changed?.plan.operations[0];
        expect(operation).toBeDefined();
        if (change === 'source metadata') {
          expect(operation?.action).toBe('skip');
          expect(operation?.sourceHash).not.toBe(before['guides/article'].contentHash);
          expect(operation?.payloadHash).toBe(before['guides/article'].payloadHash);
          await changed?.apply({ dryRun: false });
          const after = await getWordPressPublicationState({ vaultPath });
          expect(after['guides/article']).toEqual({ ...before['guides/article'], contentHash: operation?.sourceHash, inputHash: operation?.inputHash });
          expect(request).not.toHaveBeenCalled();
        } else {
          expect(operation?.action).toBe('create');
          expect(operation?.sourceHash).toBe(before['guides/article'].contentHash);
          expect(operation?.payloadHash).not.toBe(before['guides/article'].payloadHash);
          const expected = { 'image host': 'https://media.example.com/', 'image widths': 'logo-640.webp', transclusion: 'Updated include.' }[change];
          expect(operation?.intent?.content).toContain(expected);
          if (change === 'image widths') expect(operation?.distributionAssets).toContain('content/_thumbnails/guides/logo-640.webp');
          expect(await getWordPressPublicationState({ vaultPath })).toEqual(before);
        }
        expect(await readFile(articlePath, 'utf8')).toBe(changedSource);
      } finally {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        await rm(vaultPath, { recursive: true, force: true });
      }
    },
  );
});
