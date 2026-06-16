/**
 * Application-wide constants for Notopress.
 */

/**
 * The reserved slug for directory indexes and the site home page.
 */
export const INDEX_SLUG = 'page';

/**
 * The filename for the generated post index of a vault.
 */
export const INDEX_JSON = 'index.json';

/**
 * The filename for the master sitemap index of a vault.
 */
export const ROOT_JSON = 'root.json';

/**
 * The filename for the default sitemap.
 */
export const SITEMAP_XML = 'sitemap.xml';

/**
 * The filename for the sitemap containing individual pages.
 */
export const SITEMAP_PAGES_XML = 'sitemap_pages.xml';

/**
 * The default filename for the registry configuration.
 */
export const DEFAULT_REGISTRY_FILENAME = 'registry.json';

/**
 * Generated responsive image thumbnail directory.
 */
export const THUMBNAILS_DIR = '_thumbnails';

/**
 * Default responsive image widths, in pixels.
 */
export const DEFAULT_THUMBNAIL_SIZES = [320, 640, 960, 1280] as const;
