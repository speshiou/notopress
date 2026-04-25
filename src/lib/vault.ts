import { getFileFromS3 } from "./s3";
import { env } from "./env";
import { INDEX_SLUG, INDEX_JSON } from "./constants";

export interface PostMetadata {
  title: string;
  slug: string;
  date: string;
  excerpt: string;
}

export interface VaultIndex {
  version: number;
  posts: PostMetadata[];
  publicFiles: string[];
}

export type VaultContent = 
  | { type: "markdown"; content: string; matchedSlug: string }
  | { type: "collection"; posts: PostMetadata[]; requestedSlug: string };

let cachedIndex: { data: VaultIndex | null; timestamp: number } | null = null;
const CACHE_TTL = 60 * 1000; // 1 minute

/**
 * Fetches and parses the vault's index.json, handling both legacy and new formats.
 */
export async function getVaultIndex(): Promise<VaultIndex | null> {
  const now = Date.now();
  if (cachedIndex && (now - cachedIndex.timestamp < CACHE_TTL)) {
    return cachedIndex.data;
  }

  const vaultRoot = env.VAULT_ROOT;
  const bucketName = env.S3_BUCKET;

  if (!vaultRoot || !bucketName) {
    throw new Error("Site configuration missing (VAULT_ROOT or S3_BUCKET).");
  }

  try {
    const indexRaw = await getFileFromS3(bucketName, `${vaultRoot}/${INDEX_JSON}`);
    const parsed = JSON.parse(indexRaw);

    // Backward compatibility: if it's an array, it's the old format (just posts)
    if (Array.isArray(parsed)) {
      return {
        version: 0,
        posts: parsed,
        publicFiles: [],
      };
    }

    const index = parsed as VaultIndex;
    cachedIndex = { data: index, timestamp: now };
    return index;
  } catch (error) {
    console.warn(`Failed to fetch or parse index.json for ${vaultRoot}:`, error);
    cachedIndex = { data: null, timestamp: now };
    return null;
  }
}

/**
 * Resolves a request to the vault and returns the content or metadata.
 * Implements routing priority: Direct Match -> Directory Index -> Collection.
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
  
  // 2a. Direct file match (e.g., /about -> about.md)
  if (allPosts.some((p) => p.slug === requestedSlug)) {
    const markdown = await getFileFromS3(bucketName, `${vaultRoot}/${requestedSlug}.md`);
    return { type: "markdown", content: markdown, matchedSlug: requestedSlug };
  }

  // 2b. Directory index match (e.g., /folder -> folder/index.md)
  const indexSlug = `${requestedSlug === INDEX_SLUG ? "" : requestedSlug + "/"}${INDEX_SLUG}`;
  // Special case: if requestedSlug is 'index', indexSlug is 'index'. We already checked that in 2a.
  // But for subfolders, e.g., 'blog', indexSlug is 'blog/index'.
  if (requestedSlug !== INDEX_SLUG && allPosts.some((p) => p.slug === indexSlug)) {
    const markdown = await getFileFromS3(bucketName, `${vaultRoot}/${indexSlug}.md`);
    return { type: "markdown", content: markdown, matchedSlug: indexSlug };
  }

  // 2c. Collection View (list of children in a folder)
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
