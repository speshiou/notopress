import { describe, expect, it } from 'vitest';
import { isGeneratedArtifactPath } from './generated-paths';

describe('generated output ownership', () => {
  it.each(['root.json', 'content/index.json', 'content/guides/index.json', '_rendered/content/article.html', 'content/_thumbnails/image.webp', 'public/guides/sitemap.xml'])('recognizes %s', (value) => {
    expect(isGeneratedArtifactPath(value)).toBe(true);
  });
  it.each(['content/article.md', 'public/data.json', 'content/hero.png'])('preserves source %s', (value) => {
    expect(isGeneratedArtifactPath(value)).toBe(false);
  });
});
