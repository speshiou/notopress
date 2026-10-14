import { INDEX_JSON, ROOT_JSON, RENDERED_DIR, THUMBNAILS_DIR, NOTOPRESS_DIR, SITEMAP_XML, SITEMAP_PAGES_XML } from '../../../src/lib/constants';

export function isGeneratedArtifactDirectory(name: string): boolean {
  return [RENDERED_DIR, THUMBNAILS_DIR, NOTOPRESS_DIR].includes(name);
}

export function isGeneratedSitemapPath(value: string): boolean {
  const filename = value.split('/').pop();
  return filename === SITEMAP_XML || filename === SITEMAP_PAGES_XML;
}

export function isGeneratedArtifactPath(value: string): boolean {
  return value === ROOT_JSON
    || (value.startsWith('content/') && value.split('/').pop() === INDEX_JSON)
    || value.startsWith(`${RENDERED_DIR}/content/`)
    || value.split('/').includes(THUMBNAILS_DIR)
    || (value.startsWith('public/') && isGeneratedSitemapPath(value));
}
