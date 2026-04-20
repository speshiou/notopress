import { getFileFromS3 } from "./s3";

export interface PostMetadata {
  title: string;
  slug: string;
  date: string;
  excerpt: string;
}

export type VaultContent = 
  | { type: "markdown"; content: string; matchedSlug: string }
  | { type: "collection"; posts: PostMetadata[]; requestedSlug: string };

/**
 * Resolves a request to the vault and returns the content or metadata.
 * Implements routing priority: Direct Match -> Directory Index -> Collection.
 */
export async function resolveVaultRequest(slugArray?: string[]): Promise<VaultContent> {
  const vaultRoot = process.env.VAULT_ROOT;
  const bucketName = process.env.S3_BUCKET;

  if (!vaultRoot || !bucketName) {
    throw new Error("Site configuration missing (VAULT_ROOT or S3_BUCKET).");
  }

  // Normalize slug: empty array or empty string means 'index'
  const requestedSlug = slugArray && slugArray.length > 0 ? slugArray.join("/") : "index";

  // 1. Fetch index.json for validation and collection filtering
  const indexRaw = await getFileFromS3(bucketName, `${vaultRoot}/index.json`);
  const allPosts: PostMetadata[] = JSON.parse(indexRaw);

  // 2. Routing Priority Logic
  
  // 2a. Direct file match (e.g., /about -> about.md)
  if (allPosts.some((p) => p.slug === requestedSlug)) {
    const markdown = await getFileFromS3(bucketName, `${vaultRoot}/${requestedSlug}.md`);
    return { type: "markdown", content: markdown, matchedSlug: requestedSlug };
  }

  // 2b. Directory index match (e.g., /folder -> folder/index.md)
  const indexSlug = `${requestedSlug === "index" ? "" : requestedSlug + "/"}index`;
  // Special case: if requestedSlug is 'index', indexSlug is 'index'. We already checked that in 2a.
  // But for subfolders, e.g., 'blog', indexSlug is 'blog/index'.
  if (requestedSlug !== "index" && allPosts.some((p) => p.slug === indexSlug)) {
    const markdown = await getFileFromS3(bucketName, `${vaultRoot}/${indexSlug}.md`);
    return { type: "markdown", content: markdown, matchedSlug: indexSlug };
  }

  // 2c. Collection View (list of children in a folder)
  const dirPrefix = requestedSlug === "index" ? "" : `${requestedSlug}/`;
  const hasChildren = allPosts.some((p) => p.slug.startsWith(dirPrefix));

  if (requestedSlug === "index" || hasChildren) {
    const collectionPosts = allPosts.filter((p) => {
      if (dirPrefix === "") {
        // Root level: show all top-level files (excluding index itself)
        return !p.slug.includes("/") && p.slug !== "index";
      }
      // Sub-folder: show immediate children only
      if (!p.slug.startsWith(dirPrefix)) return false;
      const relativeSlug = p.slug.slice(dirPrefix.length);
      // Exclude nested children and the directory's own index file
      return !relativeSlug.includes("/") && p.slug !== "index" && p.slug !== indexSlug;
    });

    return { type: "collection", posts: collectionPosts, requestedSlug };
  }

  throw new Error("Vault resource not found");
}
