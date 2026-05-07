import { z } from "zod";
import { getFileFromS3 } from "./s3";
import { env } from "./env";
import { INDEX_SLUG, INDEX_JSON } from "./constants";

export const PostMetadataSchema = z.object({
  title: z.string(),
  slug: z.string(),
  date: z.string(),
  excerpt: z.string(),
});

export const VaultIndexSchema = z.object({
  version: z.number(),
  posts: z.array(PostMetadataSchema),
  publicFiles: z.array(z.string()),
});

export type PostMetadata = z.infer<typeof PostMetadataSchema>;
export type VaultIndex = z.infer<typeof VaultIndexSchema>;

export type VaultContent = 
  | { type: "markdown"; content: string; matchedSlug: string }
  | { type: "collection"; posts: PostMetadata[]; requestedSlug: string }
  | { type: "asset"; filePath: string };

let cachedIndex: { data: VaultIndex | null; timestamp: number } | null = null;
const SUCCESS_CACHE_TTL = 60 * 1000; // 1 minute
const ERROR_CACHE_TTL = 5 * 1000;    // 5 seconds

/**
 * Fetches and parses the vault's index.json, handling both legacy and new formats.
 */
export async function getVaultIndex(): Promise<VaultIndex | null> {
  const now = Date.now();
  if (cachedIndex) {
    const ttl = cachedIndex.data === null ? ERROR_CACHE_TTL : SUCCESS_CACHE_TTL;
    if (now - cachedIndex.timestamp < ttl) {
      return cachedIndex.data;
    }
  }

  const vaultRoot = env.VAULT_ROOT;
  const bucketName = env.S3_BUCKET;

  if (!vaultRoot || !bucketName) {
    throw new Error("Site configuration missing (VAULT_ROOT or S3_BUCKET).");
  }

  try {
    const indexRaw = await getFileFromS3(bucketName, `${vaultRoot}/${INDEX_JSON}`);
    const index = VaultIndexSchema.parse(JSON.parse(indexRaw));

    cachedIndex = { data: index, timestamp: now };
    return index;
  } catch (error) {
    console.warn(`Failed to fetch or parse index.json for ${vaultRoot}:`, error);
    // Use a shorter TTL for error states to allow faster recovery
    cachedIndex = { data: null, timestamp: now };
    return null;
  }
}

/**
 * Resolves a request to the vault and returns the content or metadata.
 * Implements routing priority: Direct Match -> Directory Index -> Asset -> Collection.
 */
export async function resolveVaultRequest(slugArray?: string[]): Promise<VaultContent | null> {
  const vaultRoot = env.VAULT_ROOT;
  const bucketName = env.S3_BUCKET;

  if (!vaultRoot || !bucketName) {
    throw new Error("Site configuration missing (VAULT_ROOT or S3_BUCKET).");
  }

  // Normalize slug: empty array or empty string means 'index'
  const requestedSlug = slugArray?.filter(Boolean).join("/") || INDEX_SLUG;

  // 1. Fetch index.json for validation and collection filtering
  const index = await getVaultIndex();
  if (!index) return null;
  const allPosts = index.posts;

  // 2. Routing Priority Logic
  
  // 2a. Direct file match (e.g., /about -> content/about.md)
  if (allPosts.some((p) => p.slug === requestedSlug)) {
    const markdown = await getFileFromS3(bucketName, `${vaultRoot}/content/${requestedSlug}.md`);
    return { type: "markdown", content: markdown, matchedSlug: requestedSlug };
  }

  // 2b. Directory index match (e.g., /folder -> content/folder/page.md)
  const indexSlug = `${requestedSlug === INDEX_SLUG ? "" : requestedSlug + "/"}${INDEX_SLUG}`;
  // Special case: if requestedSlug is 'page', indexSlug is 'page'. We already checked that in 2a.
  // But for subfolders, e.g., 'blog', indexSlug is 'blog/page'.
  if (requestedSlug !== INDEX_SLUG && allPosts.some((p) => p.slug === indexSlug)) {
    const markdown = await getFileFromS3(bucketName, `${vaultRoot}/content/${indexSlug}.md`);
    return { type: "markdown", content: markdown, matchedSlug: indexSlug };
  }

  // 2c. Public asset match (e.g., /images/logo.png)
  if (index.publicFiles && index.publicFiles.includes(requestedSlug)) {
    return { type: "asset", filePath: requestedSlug };
  }

  // 2d. Collection View (list of children in a folder)
  const dirPrefix = requestedSlug === INDEX_SLUG ? "" : `${requestedSlug}/`;
  const hasChildren = allPosts.some((p) => p.slug.startsWith(dirPrefix));

  if (requestedSlug === INDEX_SLUG || hasChildren) {
    const collectionPosts = allPosts.filter((p) => {
      if (dirPrefix === "") {
        // Root level: show all top-level files (excluding index itself)
        return !p.slug.includes("/") && p.slug !== INDEX_SLUG;
      }
      // Sub-folder: show immediate children only
      if (!p.slug.startsWith(dirPrefix)) return false;
      const relativeSlug = p.slug.slice(dirPrefix.length);
      // Exclude nested children and the directory's own index file
      return !relativeSlug.includes("/") && p.slug !== INDEX_SLUG && p.slug !== indexSlug;
    });

    return { type: "collection", posts: collectionPosts, requestedSlug };
  }

  return null;
}
