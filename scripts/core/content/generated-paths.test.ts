import { describe, expect, it } from 'vitest';
import { isGeneratedArtifactDirectory, isGeneratedSitemapPath } from './generated-paths';

describe('generated output ownership', () => {
  it.each(['_rendered', '_thumbnails', '.notopress'])('recognizes generated directory %s', (value) => {
    expect(isGeneratedArtifactDirectory(value)).toBe(true);
  });
  it.each(['content', 'public', 'articles'])('preserves source directory %s', (value) => {
    expect(isGeneratedArtifactDirectory(value)).toBe(false);
  });
  it.each(['sitemap.xml', 'public/guides/sitemap_pages.xml'])('recognizes sitemap %s', (value) => {
    expect(isGeneratedSitemapPath(value)).toBe(true);
  });
  it('preserves other public files', () => {
    expect(isGeneratedSitemapPath('public/data.json')).toBe(false);
  });
});
