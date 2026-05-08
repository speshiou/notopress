import { z } from "zod";
import { getFileFromS3 } from "./s3";
import { env } from "./env";
import { INDEX_SLUG, INDEX_JSON, ROOT_JSON } from "./constants";

export const PageMetadataSchema = z.object({
  title: z.string(),
  slug: z.string(),
  date: z.string(),
  updatedAt: z.string().optional(),
  excerpt: z.string(),
});

export const VaultIndexSchema = z.object({
  version: z.number(),
  pages: z.array(PageMetadataSchema),
  directories: z.array(z.string()).optional(),
  publicFiles: z.array(z.string()).optional(),
});

export type PageMetadata = z.infer<typeof PageMetadataSchema>;
export type VaultIndex = z.infer<typeof VaultIndexSchema>;

export type VaultContent =
  | { type: "markdown"; content: string; matchedSlug: string; metadata: PageMetadata }
  | { type: "collection"; pages: PageMetadata[]; requestedSlug: string }
  | { type: "asset"; filePath: string };

// Cache for multiple indices
const indexCache = new Map<string, { data: VaultIndex | null; timestamp: number }>();
const SUCCESS_CACHE_TTL = 60 * 1000; // 1 minute
const ERROR_CACHE_TTL = 5 * 1000;    // 5 seconds

/**
 * Fetches and parses a specific index.json or root.json from the vault.
 */
export async function getVaultIndex(subPath: string = ""): Promise<VaultIndex | null> {
  const now = Date.now();
  const cacheKey = subPath || "ROOT";

  const cached = indexCache.get(cacheKey);
  if (cached) {
    const ttl = cached.data === null ? ERROR_CACHE_TTL : SUCCESS_CACHE_TTL;
    if (now - cached.timestamp < ttl) {
      return cached.data;
    }
  }

  const vaultRoot = env.VAULT_ROOT;
  const bucketName = env.S3_BUCKET;

  if (!vaultRoot || !bucketName) {
    throw new Error("Site configuration missing (VAULT_ROOT or S3_BUCKET).");
  }

  try {
    const fileName = subPath === "" ? ROOT_JSON : `content/${subPath}/${INDEX_JSON}`;
    const indexRaw = await getFileFromS3(bucketName, `${vaultRoot}/${fileName}`);
    const index = VaultIndexSchema.parse(JSON.parse(indexRaw));

    indexCache.set(cacheKey, { data: index, timestamp: now });
    return index;
  } catch (error) {
    console.warn(`Failed to fetch index at "${subPath}" for ${vaultRoot}:`, error);
    indexCache.set(cacheKey, { data: null, timestamp: now });
    return null;
  }
}

/**
 * Resolves a request by jumping directly to the correct index using the master directory map.
 */
export async function resolveVaultRequest(slugArray?: string[]): Promise<VaultContent | null> {
  const vaultRoot = env.VAULT_ROOT;
  const bucketName = env.S3_BUCKET;

  if (!vaultRoot || !bucketName) {
    throw new Error("Site configuration missing (VAULT_ROOT or S3_BUCKET).");
  }

  const segments = slugArray?.filter(Boolean) || [];
  const requestedSlug = segments.join("/") || INDEX_SLUG;

  // 1. Fetch root index (The Master Map)
  const rootIndex = await getVaultIndex("");
  if (!rootIndex) return null;

  // 2. Check for public asset match (only in root.json)
  if (segments.length > 0 && rootIndex.publicFiles?.includes(requestedSlug)) {
    return { type: "asset", filePath: requestedSlug };
  }

  // 3. Routing Priority Logic

  // 3a. Is it a page at the root level?
  const rootPageMatch = rootIndex.pages.find(p => p.slug === requestedSlug);
  if (rootPageMatch) {
    const markdown = await getFileFromS3(bucketName, `${vaultRoot}/content/${rootPageMatch.slug}.md`);
    return { type: "markdown", content: markdown, matchedSlug: rootPageMatch.slug, metadata: rootPageMatch };
  }

  // 3b. Is it a page in a nested directory? (Direct Jump)
  const parentDir = segments.length > 1 ? segments.slice(0, -1).join("/") : null;
  const lastSegment = segments.length > 0 ? segments[segments.length - 1] : null;

  if (parentDir && rootIndex.directories?.includes(parentDir)) {
    const dirIndex = await getVaultIndex(parentDir);
    const nestedMatch = dirIndex?.pages.find(p => p.slug === lastSegment);
    if (nestedMatch) {
      // requestedSlug is the full path required for S3
      const markdown = await getFileFromS3(bucketName, `${vaultRoot}/content/${requestedSlug}.md`);
      return { type: "markdown", content: markdown, matchedSlug: requestedSlug, metadata: nestedMatch };
    }
  }

  // 3c. Is it a directory? (Collection View)
  const isDirectory = rootIndex.directories?.includes(requestedSlug) || requestedSlug === INDEX_SLUG;
  if (isDirectory) {
    const targetDir = requestedSlug === INDEX_SLUG ? "" : requestedSlug;
    const dirIndex = await getVaultIndex(targetDir);

    if (dirIndex) {
      // Pages are already relative, just exclude the index file
      const collectionPages = dirIndex.pages.filter(p => p.slug !== INDEX_SLUG);
      return { type: "collection", pages: collectionPages, requestedSlug };
    }
  }

  // 3d. Fallback: Is it an index page inside a folder (e.g., /folder -> folder/page.md)
  if (rootIndex.directories?.includes(requestedSlug)) {
    const dirIndex = await getVaultIndex(requestedSlug);
    const indexMatch = dirIndex?.pages.find(p => p.slug === INDEX_SLUG);
    if (indexMatch) {
      const fullPath = `${requestedSlug}/${INDEX_SLUG}`;
      const markdown = await getFileFromS3(bucketName, `${vaultRoot}/content/${fullPath}.md`);
      return { type: "markdown", content: markdown, matchedSlug: fullPath, metadata: indexMatch };
    }
  }

  return null;
}
