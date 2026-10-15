import { describe, expect, it } from 'vitest';
import { collectWordPressAssetUrls } from './distribution-assets';
import { createDistributionAssetResolver } from '../../core/content/distribution-assets';

describe('WordPress-owned distribution assets', () => {
  it('collects normal HTML and nested Gutenberg attributes without changing opaque blocks', () => {
    const html = '<img src="https://assets.example.com/example/content/_thumbnails/hero-8.webp">\n<!-- wp:example/group {"image":{"url":"https://assets.example.com/example/content/diagram.svg"}} --><!-- wp:example/visual {"slides":[{"poster":"https://assets.example.com/example/public/poster.svg"}]} /--><!-- /wp:example/group -->';
    const resolve = createDistributionAssetResolver({ siteId: 'example', imageHost: 'https://assets.example.com', assetFiles: ['diagram.svg'], publicFiles: ['poster.svg'], generatedPaths: ['content/_thumbnails/hero-8.webp'], collectUrls: collectWordPressAssetUrls });
    expect(resolve({ html, sourceDirectory: '' })).toEqual(['content/_thumbnails/hero-8.webp', 'content/diagram.svg', 'public/poster.svg']);
  });
  it('ignores external URLs and prose while resolving known relative block assets', () => {
    const html = '<!-- wp:example/visual {"image":"diagram.svg","external":"https://elsewhere.example.com/image.svg","caption":"Example caption"} /-->';
    const resolve = createDistributionAssetResolver({ siteId: 'example', imageHost: 'https://assets.example.com', assetFiles: ['guides/diagram.svg'], publicFiles: [], generatedPaths: [], collectUrls: collectWordPressAssetUrls });
    expect(resolve({ html, sourceDirectory: 'guides' })).toEqual(['content/guides/diagram.svg']);
  });
  it('rejects malformed parser output instead of silently losing asset dependencies', () => {
    expect(() => collectWordPressAssetUrls({ html: 'example', parseBlocks: () => ({ invalid: true }) })).toThrow();
  });
});
