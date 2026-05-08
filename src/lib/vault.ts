import { z } from "zod";
import { getFileFromS3 } from "./s3";
import { INDEX_SLUG, INDEX_JSON, ROOT_JSON } from "./constants";
import { createCache } from "./cache";

export const PageMetadataSchema = z.object({
  title: z.string(),
  slug: z.string(),
  date: z.string(),
  updatedAt: z.string().optional(),
  excerpt: z.string(),
});

export const VaultDirectoryIndexSchema = z.object({
  version: z.number(),
  pages: z.array(PageMetadataSchema),
});

export const VaultRootIndexSchema = VaultDirectoryIndexSchema.extend({
  directories: z.array(z.string()),
  publicFiles: z.array(z.string()),
});

export type PageMetadata = z.infer<typeof PageMetadataSchema>;
export type VaultDirectoryIndex = z.infer<typeof VaultDirectoryIndexSchema>;
export type VaultRootIndex = z.infer<typeof VaultRootIndexSchema>;
export type VaultIndex = VaultDirectoryIndex | VaultRootIndex;

export type VaultContent =
  | { type: "markdown"; content: string; matchedSlug: string; metadata: PageMetadata }
  | { type: "collection"; pages: PageMetadata[]; requestedSlug: string }
  | { type: "asset"; filePath: string };

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

/**
 * Resolves a request by jumping directly to the correct index using the master directory map.
 */
export async function resolveVaultRequest(config: VaultConfig, slugArray?: string[]): Promise<VaultContent | null> {
  const segments = slugArray?.filter(Boolean) || [];
  const requestedSlug = segments.join("/") || INDEX_SLUG;

  // 1. Fetch root index (The Master Map)
  const rootIndex = await fetchRootIndex(config);
  if (!rootIndex) return null;

  // 2. Check for public asset match (only in root.json)
  if (segments.length > 0 && rootIndex.publicFiles.includes(requestedSlug)) {
    return { type: "asset", filePath: requestedSlug };
  }

  // 3. Routing Priority Logic
  
  // 3a. Is it a page at the root level?
  const rootPageMatch = rootIndex.pages.find(p => p.slug === requestedSlug);
  if (rootPageMatch) {
    const markdown = await getFileFromS3(config.bucketName, `${config.vaultRoot}/content/${rootPageMatch.slug}.md`);
    return { type: "markdown", content: markdown, matchedSlug: rootPageMatch.slug, metadata: rootPageMatch };
  }

  // 3b. Is it a page in a nested directory? (Direct Jump)
  const parentDir = segments.length > 1 ? segments.slice(0, -1).join("/") : null;
  const lastSegment = segments.length > 0 ? segments[segments.length - 1] : null;

  if (parentDir && rootIndex.directories.includes(parentDir)) {
    const dirIndex = await fetchDirectoryIndex(config, parentDir);
    const nestedMatch = dirIndex?.pages.find(p => p.slug === lastSegment);
    if (nestedMatch) {
      // requestedSlug is the full path required for S3
      const markdown = await getFileFromS3(config.bucketName, `${config.vaultRoot}/content/${requestedSlug}.md`);
      return { type: "markdown", content: markdown, matchedSlug: requestedSlug, metadata: nestedMatch };
    }
  }

  // 3c. Is it a directory? (Collection View)
  const isDirectory = rootIndex.directories.includes(requestedSlug) || requestedSlug === INDEX_SLUG;
  if (isDirectory) {
    const targetDir = requestedSlug === INDEX_SLUG ? "" : requestedSlug;
    const dirIndex = await fetchDirectoryIndex(config, targetDir);
    
    if (dirIndex) {
      // Pages are already relative, just exclude the index file
      const collectionPages = dirIndex.pages.filter(p => p.slug !== INDEX_SLUG);
      return { type: "collection", pages: collectionPages, requestedSlug: targetDir };
    }
  }

  // 3d. Fallback: Is it an index page inside a folder (e.g., /folder -> folder/page.md)
  if (rootIndex.directories.includes(requestedSlug)) {
    const dirIndex = await fetchDirectoryIndex(config, requestedSlug);
    const indexMatch = dirIndex?.pages.find(p => p.slug === INDEX_SLUG);
    if (indexMatch) {
      const fullPath = `${requestedSlug}/${INDEX_SLUG}`;
      const markdown = await getFileFromS3(config.bucketName, `${config.vaultRoot}/content/${fullPath}.md`);
      return { type: "markdown", content: markdown, matchedSlug: fullPath, metadata: indexMatch };
    }
  }

  return null;
}
