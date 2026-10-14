import { z } from "zod";
import { getFileFromS3 } from "./s3";
import { INDEX_SLUG, INDEX_JSON, ROOT_JSON, RENDERED_DIR } from "./constants";
import { createCache } from "./cache";
import { ContentTaxonomiesSchema } from "../domain/content-metadata";
import {
  composeFullSlug,
  findPublicSlugForFullSlug,
  getNoteHref,
  hasVaultRoutes,
  isRouteWinner,
  splitFullSlug,
  toPublicSlug,
} from "./rewrites";

export const PageMetadataSchema = z.object({
  title: z.string(),
  slug: z.string(),
  publicSlug: z.string().optional(),
  date: z.string(),
  updatedAt: z.string().optional(),
  excerpt: z.string(),
  ...ContentTaxonomiesSchema.shape,
});

export const VaultDirectoryIndexSchema = z.object({
  version: z.number(),
  pages: z.array(PageMetadataSchema),
});

export const VaultRootIndexSchema = VaultDirectoryIndexSchema.extend({
  directories: z.array(z.string()),
  publicFiles: z.array(z.string()),
  assetFiles: z.array(z.string()).optional(),
  responsiveImageWidths: z.record(z.string(), z.array(z.number().int().positive())).optional(),
  noteIncludes: z.array(z.object({
    fullSlug: z.string(),
    title: z.string(),
    filePath: z.string(),
    linkable: z.literal(false).optional(),
  })).optional(),
  thumbnailSizes: z.array(z.number().int().positive()).optional(),
  routes: z.record(z.string(), z.string()).optional(),
  publicDirectories: z.array(z.string()).optional(),
});

export type PageMetadata = z.infer<typeof PageMetadataSchema>;
export type VaultDirectoryIndex = z.infer<typeof VaultDirectoryIndexSchema>;
export type VaultRootIndex = z.infer<typeof VaultRootIndexSchema>;
export type VaultIndex = VaultDirectoryIndex | VaultRootIndex;

export type VaultContent =
  | {
      type: "html";
      renderedHtml: string;
      matchedSlug: string;
      metadata: PageMetadata;
    }
  | { type: "collection"; pages: PageMetadata[]; requestedSlug: string }
  | { type: "asset"; filePath: string }
  | { type: "redirect"; href: string };

export type VaultConfig = {
  bucketName: string;
  vaultRoot: string;
};

// Cache for multiple indices
const indexCache = createCache<VaultIndex>(60 * 1000, 5 * 1000);

/**
 * Clears the internal vault index cache. Useful for testing or manual resets.
 */
export function clearVaultCache() {
  indexCache.clear();
}
async function fetchIndex<T extends VaultIndex>(
  config: VaultConfig,
  cacheKey: string,
  fileName: string,
  schema: z.ZodType<T>
): Promise<T | null> {
  const fullCacheKey = `${config.bucketName}:${config.vaultRoot}:${cacheKey}`;
  const cached = indexCache.get(fullCacheKey);
  
  if (cached !== undefined) {
    return cached as T | null;
  }

  try {
    const indexRaw = await getFileFromS3(config.bucketName, `${config.vaultRoot}/${fileName}`);
    const index = schema.parse(JSON.parse(indexRaw));
    indexCache.set(fullCacheKey, index);
    return index;
  } catch (error) {
    console.warn(`Failed to fetch index "${fileName}" for ${config.vaultRoot}:`, error);
    indexCache.set(fullCacheKey, null);
    return null;
  }
}

/**
 * Fetches the master sitemap index (root.json).
 */
export async function fetchRootIndex(config: VaultConfig): Promise<VaultRootIndex | null> {
  return fetchIndex(config, "ROOT", ROOT_JSON, VaultRootIndexSchema);
}

/**
 * Fetches a directory-level index (content/.../index.json).
 */
export async function fetchDirectoryIndex(config: VaultConfig, subPath: string): Promise<VaultDirectoryIndex | null> {
  if (!subPath) return fetchRootIndex(config);
  return fetchIndex(config, subPath, `content/${subPath}/${INDEX_JSON}`, VaultDirectoryIndexSchema);
}

async function fetchRenderedHtml(config: VaultConfig, fullSlug: string): Promise<string | undefined> {
  try {
    return await getFileFromS3(config.bucketName, `${config.vaultRoot}/${RENDERED_DIR}/content/${fullSlug}.html`);
  } catch {
    return undefined;
  }
}

async function loadHtmlPage({
  config,
  fullSlug,
  metadata,
}: {
  config: VaultConfig;
  fullSlug: string;
  metadata: PageMetadata;
}): Promise<Extract<VaultContent, { type: "html" }> | null> {
  const renderedHtml = await fetchRenderedHtml(config, fullSlug);
  if (renderedHtml === undefined) return null;
  return {
    type: "html",
    renderedHtml,
    matchedSlug: fullSlug,
    metadata,
  };
}

async function loadPageMetadata({
  config,
  rootIndex,
  fullSlug,
}: {
  config: VaultConfig;
  rootIndex: VaultRootIndex;
  fullSlug: string;
}): Promise<PageMetadata | null> {
  const { directory, slug } = splitFullSlug({ fullSlug });
  if (!directory) {
    return rootIndex.pages.find((page) => page.slug === slug) || null;
  }
  const dirIndex = await fetchDirectoryIndex(config, directory);
  return dirIndex?.pages.find((page) => page.slug === slug) || null;
}

function collectionPagesForDirectory({
  directory,
  pages,
  routes,
}: {
  directory: string;
  pages: PageMetadata[];
  routes?: Record<string, string>;
}): PageMetadata[] {
  return pages.filter((page) => {
    if (page.slug === INDEX_SLUG) {
      return false;
    }
    const fullSlug = composeFullSlug({ directory, slug: page.slug });
    const publicSlug = page.publicSlug ?? toPublicSlug({ fullSlug });
    if (routes && !isRouteWinner({ routes, publicSlug, fullSlug })) {
      return false;
    }
    if (!directory) {
      return true;
    }
    return publicSlug === directory || publicSlug.startsWith(`${directory}/`);
  });
}

/**
 * Resolves a request by jumping directly to the correct index using the master directory map.
 */
export async function resolveVaultRequest(config: VaultConfig, slugArray?: string[]): Promise<VaultContent | null> {
  const segments = slugArray?.filter(Boolean) || [];
  const requestedSlug = segments.join("/") || INDEX_SLUG;

  const rootIndex = await fetchRootIndex(config);
  if (!rootIndex) return null;

  if (segments.length > 0 && rootIndex.publicFiles.includes(requestedSlug)) {
    return { type: "asset", filePath: requestedSlug };
  }

  if (hasVaultRoutes({ routes: rootIndex.routes })) {
    const routes = rootIndex.routes || {};
    const redirectPublicSlug = findPublicSlugForFullSlug({ routes, fullSlug: requestedSlug });
    if (redirectPublicSlug && redirectPublicSlug !== requestedSlug) {
      return { type: "redirect", href: getNoteHref({ publicSlug: redirectPublicSlug }) };
    }

    const routedFullSlug = routes[requestedSlug];
    if (routedFullSlug) {
      const metadata = await loadPageMetadata({ config, rootIndex, fullSlug: routedFullSlug });
      if (!metadata) {
        return null;
      }
      return loadHtmlPage({ config, fullSlug: routedFullSlug, metadata });
    }

    const publicDirectories = rootIndex.publicDirectories || [];
    const isPublicDirectory = publicDirectories.includes(requestedSlug) || requestedSlug === INDEX_SLUG;
    if (!isPublicDirectory) {
      return null;
    }

    const targetDir = requestedSlug === INDEX_SLUG ? "" : requestedSlug;
    const dirIndex = await fetchDirectoryIndex(config, targetDir);
    if (!dirIndex) {
      return null;
    }

    const indexMatch = dirIndex.pages.find((page) => page.slug === INDEX_SLUG);
    if (indexMatch) {
      const fullPath = composeFullSlug({ directory: targetDir, slug: INDEX_SLUG });
      const indexPublicSlug = indexMatch.publicSlug ?? toPublicSlug({ fullSlug: fullPath });
      if (!routes[requestedSlug] && isRouteWinner({ routes, publicSlug: indexPublicSlug, fullSlug: fullPath })) {
        return loadHtmlPage({ config, fullSlug: fullPath, metadata: indexMatch });
      }
    }

    return {
      type: "collection",
      pages: collectionPagesForDirectory({ directory: targetDir, pages: dirIndex.pages, routes }),
      requestedSlug: targetDir,
    };
  }

  const rootPageMatch = rootIndex.pages.find(p => p.slug === requestedSlug);
  if (rootPageMatch) {
    return loadHtmlPage({
      config,
      fullSlug: rootPageMatch.slug,
      metadata: rootPageMatch,
    });
  }

  const parentDir = segments.length > 1 ? segments.slice(0, -1).join("/") : null;
  const lastSegment = segments.length > 0 ? segments[segments.length - 1] : null;

  if (parentDir && rootIndex.directories.includes(parentDir)) {
    const dirIndex = await fetchDirectoryIndex(config, parentDir);
    const nestedMatch = dirIndex?.pages.find(p => p.slug === lastSegment);
    if (nestedMatch) {
      return loadHtmlPage({
        config,
        fullSlug: requestedSlug,
        metadata: nestedMatch,
      });
    }
  }

  const isDirectory = rootIndex.directories.includes(requestedSlug) || requestedSlug === INDEX_SLUG;
  if (isDirectory) {
    const targetDir = requestedSlug === INDEX_SLUG ? "" : requestedSlug;
    const dirIndex = await fetchDirectoryIndex(config, targetDir);
    
    if (dirIndex) {
      const indexMatch = dirIndex.pages.find(p => p.slug === INDEX_SLUG);
      if (indexMatch) {
        const fullPath = composeFullSlug({ directory: targetDir, slug: INDEX_SLUG });
        return loadHtmlPage({
          config,
          fullSlug: fullPath,
          metadata: indexMatch,
        });
      }

      return {
        type: "collection",
        pages: collectionPagesForDirectory({ directory: targetDir, pages: dirIndex.pages }),
        requestedSlug: targetDir,
      };
    }
  }

  return null;
}
