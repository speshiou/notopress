import { z } from "zod";
import { getFileFromS3 } from "./s3";
import { DEFAULT_THUMBNAIL_SIZES, INDEX_SLUG, INDEX_JSON, ROOT_JSON, RENDERED_DIR } from "./constants";
import { createCache } from "./cache";
import matter from "gray-matter";
import {
  createNoteReferenceResolver,
  extractWikilinkTargets,
  type NoteReference,
  type NoteReferenceInput,
} from "./note-links";

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
  assetFiles: z.array(z.string()).optional(),
  noteIncludes: z.array(z.object({
    fullSlug: z.string(),
    title: z.string(),
    filePath: z.string(),
    linkable: z.literal(false).optional(),
  })).optional(),
  thumbnailSizes: z.array(z.number().int().positive()).optional(),
});

export type PageMetadata = z.infer<typeof PageMetadataSchema>;
export type VaultDirectoryIndex = z.infer<typeof VaultDirectoryIndexSchema>;
export type VaultRootIndex = z.infer<typeof VaultRootIndexSchema>;
export type VaultIndex = VaultDirectoryIndex | VaultRootIndex;

export type VaultContent =
  | {
      type: "markdown";
      content: string;
      renderedHtml?: string;
      matchedSlug: string;
      metadata: PageMetadata;
      thumbnailSizes: readonly number[];
    }
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

async function fetchRenderedHtml(config: VaultConfig, fullSlug: string): Promise<string | undefined> {
  try {
    return await getFileFromS3(config.bucketName, `${config.vaultRoot}/${RENDERED_DIR}/content/${fullSlug}.html`);
  } catch {
    return undefined;
  }
}

function stripFirstMarkdownHeading(markdown: string): string {
  return markdown.replace(/^#\s+.+$/m, "").trim();
}

function buildNoteReferenceInputs({
  rootIndex,
  directoryIndices,
}: {
  rootIndex: VaultRootIndex;
  directoryIndices: ReadonlyMap<string, VaultDirectoryIndex>;
}): NoteReferenceInput[] {
  const noteReferences: NoteReferenceInput[] = rootIndex.pages.map((page) => ({
    fullSlug: page.slug,
    title: page.title,
  }));

  for (const [directory, directoryIndex] of directoryIndices.entries()) {
    for (const page of directoryIndex.pages) {
      noteReferences.push({
        fullSlug: `${directory}/${page.slug}`,
        title: page.title,
      });
    }
  }

  return noteReferences;
}

export async function fetchNoteReferencesForMarkdown({
  config,
  markdown,
  rootIndex,
}: {
  config: VaultConfig;
  markdown: string;
  rootIndex: VaultRootIndex;
}): Promise<NoteReference[]> {
  const wikilinkTargets = extractWikilinkTargets(markdown);
  if (wikilinkTargets.links.length === 0 && wikilinkTargets.embeds.length === 0) {
    return [];
  }

  const directoryEntries = await Promise.all(
    rootIndex.directories.map(async (directory): Promise<[string, VaultDirectoryIndex] | null> => {
      const directoryIndex = await fetchDirectoryIndex(config, directory);
      return directoryIndex ? [directory, directoryIndex] : null;
    })
  );
  const directoryIndices = new Map(directoryEntries.filter((entry): entry is [string, VaultDirectoryIndex] => entry !== null));
  const referenceInputs = buildNoteReferenceInputs({ rootIndex, directoryIndices });
  const publicResolver = createNoteReferenceResolver({ notes: referenceInputs });
  const embedResolver = createNoteReferenceResolver({ notes: [...referenceInputs, ...(rootIndex.noteIncludes || [])] });
  const privateIncludesBySlug = new Map((rootIndex.noteIncludes || []).map((include) => [include.fullSlug, include]));
  const referencesByFullSlug = new Map<string, NoteReference>();
  const embedTargetsToFetch = [...wikilinkTargets.embeds];
  const fetchedEmbedSlugs = new Set<string>();

  for (const target of wikilinkTargets.links) {
    const reference = publicResolver.resolve({ target });
    if (reference) {
      referencesByFullSlug.set(reference.fullSlug, reference);
    }
  }

  for (const target of wikilinkTargets.embeds) {
    const reference = embedResolver.resolve({ target });
    if (reference) {
      referencesByFullSlug.set(reference.fullSlug, reference);
    }
  }

  while (embedTargetsToFetch.length > 0) {
    const target = embedTargetsToFetch.shift();
    if (!target) {
      continue;
    }

    const reference = embedResolver.resolve({ target });
    if (!reference) {
      continue;
    }
    if (fetchedEmbedSlugs.has(reference.fullSlug)) {
      continue;
    }
    fetchedEmbedSlugs.add(reference.fullSlug);

    try {
      const privateInclude = privateIncludesBySlug.get(reference.fullSlug);
      const embeddedMarkdown = await getFileFromS3(
        config.bucketName,
        privateInclude
          ? `${config.vaultRoot}/${privateInclude.filePath}`
          : `${config.vaultRoot}/content/${reference.fullSlug}.md`
      );
      const { content } = matter(embeddedMarkdown);
      const bodyContent = stripFirstMarkdownHeading(content);
      referencesByFullSlug.set(reference.fullSlug, {
        ...reference,
        content: bodyContent,
      });

      const nestedTargets = extractWikilinkTargets(bodyContent);
      for (const nestedTarget of nestedTargets.links) {
        const nestedReference = publicResolver.resolve({ target: nestedTarget });
        if (nestedReference) {
          referencesByFullSlug.set(nestedReference.fullSlug, nestedReference);
        }
      }
      for (const nestedTarget of nestedTargets.embeds) {
        const nestedReference = embedResolver.resolve({ target: nestedTarget });
        if (nestedReference) {
          referencesByFullSlug.set(nestedReference.fullSlug, nestedReference);
        }
      }
      embedTargetsToFetch.push(...nestedTargets.embeds);
    } catch (error) {
      console.warn(`Failed to fetch embedded note "${reference.fullSlug}" for ${config.vaultRoot}:`, error);
    }
  }

  return [...referencesByFullSlug.values()];
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
  const thumbnailSizes = rootIndex.thumbnailSizes || DEFAULT_THUMBNAIL_SIZES;

  // 2. Check for public asset match (only in root.json)
  if (segments.length > 0 && rootIndex.publicFiles.includes(requestedSlug)) {
    return { type: "asset", filePath: requestedSlug };
  }

  // 3. Routing Priority Logic
  
  // 3a. Is it a page at the root level?
  const rootPageMatch = rootIndex.pages.find(p => p.slug === requestedSlug);
  if (rootPageMatch) {
    const renderedHtml = await fetchRenderedHtml(config, rootPageMatch.slug);
    const markdown = renderedHtml
      ? ""
      : await getFileFromS3(config.bucketName, `${config.vaultRoot}/content/${rootPageMatch.slug}.md`);
    return { type: "markdown", content: markdown, renderedHtml, matchedSlug: rootPageMatch.slug, metadata: rootPageMatch, thumbnailSizes };
  }

  // 3b. Is it a page in a nested directory? (Direct Jump)
  const parentDir = segments.length > 1 ? segments.slice(0, -1).join("/") : null;
  const lastSegment = segments.length > 0 ? segments[segments.length - 1] : null;

  if (parentDir && rootIndex.directories.includes(parentDir)) {
    const dirIndex = await fetchDirectoryIndex(config, parentDir);
    const nestedMatch = dirIndex?.pages.find(p => p.slug === lastSegment);
    if (nestedMatch) {
      // requestedSlug is the full path required for S3
      const renderedHtml = await fetchRenderedHtml(config, requestedSlug);
      const markdown = renderedHtml
        ? ""
        : await getFileFromS3(config.bucketName, `${config.vaultRoot}/content/${requestedSlug}.md`);
      return { type: "markdown", content: markdown, renderedHtml, matchedSlug: requestedSlug, metadata: nestedMatch, thumbnailSizes };
    }
  }

  // 3c. Is it a directory? (Serves Index Page or Collection View)
  const isDirectory = rootIndex.directories.includes(requestedSlug) || requestedSlug === INDEX_SLUG;
  if (isDirectory) {
    const targetDir = requestedSlug === INDEX_SLUG ? "" : requestedSlug;
    const dirIndex = await fetchDirectoryIndex(config, targetDir);
    
    if (dirIndex) {
      // Priority 1: Check for explicit index page (e.g. folder/page.md)
      const indexMatch = dirIndex.pages.find(p => p.slug === INDEX_SLUG);
      if (indexMatch) {
        const fullPath = targetDir ? `${targetDir}/${INDEX_SLUG}` : INDEX_SLUG;
        const renderedHtml = await fetchRenderedHtml(config, fullPath);
        const markdown = renderedHtml
          ? ""
          : await getFileFromS3(config.bucketName, `${config.vaultRoot}/content/${fullPath}.md`);
        return { type: "markdown", content: markdown, renderedHtml, matchedSlug: fullPath, metadata: indexMatch, thumbnailSizes };
      }

      // Priority 2: Return collection view
      const collectionPages = dirIndex.pages.filter(p => p.slug !== INDEX_SLUG);
      return { type: "collection", pages: collectionPages, requestedSlug: targetDir };
    }
  }

  return null;
}
