import { RENDERED_DIR, THUMBNAILS_DIR, NOTOPRESS_DIR, SITEMAP_XML, SITEMAP_PAGES_XML } from '../../../src/lib/constants';

export function isGeneratedArtifactDirectory(name: string): boolean {
  return [RENDERED_DIR, THUMBNAILS_DIR, NOTOPRESS_DIR].includes(name);
}

export function isGeneratedSitemapPath(value: string): boolean {
  const filename = value.split('/').pop();
  return filename === SITEMAP_XML || filename === SITEMAP_PAGES_XML;
}
