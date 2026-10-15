import { describe, expect, it } from 'vitest';
import { createWordPressImageAliasResolver } from './image-aliases';
import type { WordPressAssetEntry } from './import-assets';
import { renderMarkdownContent } from '../../../src/lib/markdown';
import { createDistributionAssetResolver } from '../../core/content/distribution-assets';

const imageHost = 'https://assets.example.com';
const source = `${imageHost}/example/content/legacy/%25E6%25B8%25AC%25E8%25A9%25A6.png`;
const entry: WordPressAssetEntry = { root: 'content', path: 'assets/example-original.png', originalUrl: source, contentHash: 'a'.repeat(64) };
function resolver(state: Record<string, WordPressAssetEntry> = { [`scope:${source}`]: entry }) {
  return createWordPressImageAliasResolver({ scope: 'scope', state, siteId: 'example', imageHost, availableFiles: [entry.path, 'assets/other.png'] });
}

describe('recorded WordPress image aliases', () => {
  it('resolves encoded local paths and exact hosted URLs to the recorded original', () => {
    const resolve = resolver();
    expect(resolve('/legacy/%E6%B8%AC%E8%A9%A6.png')).toBe(entry.path);
    expect(resolve('legacy/測試.png')).toBe(entry.path);
    expect(resolve(source)).toBe(entry.path);
  });
  it('ignores other endpoints and missing recorded originals', () => {
    expect(resolver({ [`other-scope:${source}`]: entry })(source)).toBeUndefined();
    expect(resolver({ [`scope:${source}`]: { ...entry, path: 'assets/missing.png' } })(source)).toBeUndefined();
    expect(resolver()('different-folder/測試.png')).toBeUndefined();
  });
  it('rejects conflicting recorded aliases instead of choosing by filename similarity', () => {
    const resolve = resolver({ [`scope:${source}`]: entry,
      [`scope:${imageHost}/example/content/legacy/%E6%B8%AC%E8%A9%A6.png`]: { ...entry, path: 'assets/other.png' },
    });
    expect(() => resolve('legacy/測試.png')).toThrow('Ambiguous recorded WordPress image mapping');
  });
  it('renders the relocated original using its actual thumbnail widths without editing Markdown', async () => {
    const markdown = '![Example](/legacy/%E6%B8%AC%E8%A9%A6.png)';
    const html = await renderMarkdownContent({ markdown, thumbnailSizes: [320, 640, 1280], assetFiles: [entry.path],
      resolveImageAlias: resolver(), responsiveImageWidths: { [entry.path]: [320, 640, 1010] },
      assetUrlConfig: { imageHost, siteId: 'example', s3SubDir: 'content', mode: 'absolute' },
    });
    expect(html).toContain('_thumbnails/assets/example-original-1010.webp');
    expect(html).not.toContain('-1280.webp');
    expect(html).not.toContain('/legacy/');
    const assets = createDistributionAssetResolver({ siteId: 'example', imageHost, assetFiles: [entry.path], publicFiles: [], generatedPaths: [] });
    expect(assets({ html, sourceDirectory: '' })).toEqual([320, 640, 1010].map((width) => `content/_thumbnails/assets/example-original-${width}.webp`).sort());
  });
});
