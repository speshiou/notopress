import { describe, expect, it } from 'vitest';
import { createDistributionAssetResolver } from './distribution-assets';

function resolver(imageHost: string | null = 'https://assets.example.com') {
  return createDistributionAssetResolver({ siteId: 'example-site', imageHost: imageHost || undefined,
    assetFiles: ['guides/hero.png', 'guides/guide.pdf', 'diagram & sketch.svg', 'example-note.md'],
    publicFiles: ['downloads/file.pdf'],
    generatedPaths: ['content/_thumbnails/guides/hero-8.webp', 'content/_thumbnails/guides/hero-16.webp'],
  });
}

describe('distribution assets from rendered output', () => {
  it('includes actual responsive variants and visitor attachments without their unused original image', () => {
    const html = '<img src="https://assets.example.com/example-site/content/_thumbnails/guides/hero-16.webp" srcset="https://assets.example.com/example-site/content/_thumbnails/guides/hero-8.webp 8w, https://assets.example.com/example-site/content/_thumbnails/guides/hero-16.webp 16w"><a href="guide.pdf">Download</a><a href="https://assets.example.com/example-site/public/downloads/file.pdf">File</a><img src="https://external.example.com/photo.png">';
    expect(resolver()({ html, sourceDirectory: 'guides' })).toEqual(['content/_thumbnails/guides/hero-16.webp', 'content/_thumbnails/guides/hero-8.webp', 'content/guides/guide.pdf', 'public/downloads/file.pdf']);
  });
  it('handles app-relative URLs and URI/entity decoding', () => {
    expect(resolver(null)({ html: '<img src="/api/vault-public/diagram%20&amp;%20sketch.svg">', sourceDirectory: '' })).toEqual(['content/diagram & sketch.svg']);
  });
  it('retains missing references for scoped validation and rejects source Markdown or traversal', () => {
    expect(resolver()({ html: '<img src="https://assets.example.com/example-site/content/missing.webp">', sourceDirectory: '' })).toEqual(['content/missing.webp']);
    for (const path of ['example-note.md', '%2E%2E/secret.png']) {
      expect(() => resolver()({ html: `<img src="https://assets.example.com/example-site/content/${path}">`, sourceDirectory: '' })).toThrow('Invalid distribution asset');
    }
  });
});
