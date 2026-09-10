import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { z } from 'zod';
import { parse as parseWordPressBlocks } from '@wordpress/block-serialization-default-parser';
import { Site, Registry } from '../../src/domain/registry';
import { VaultDirectoryIndex, VaultRootIndexSchema } from '../../src/lib/vault';
import { renderMarkdownContent } from '../../src/lib/markdown';
import { serializeHtmlToWordPressBlocks } from '../../src/lib/wordpress-blocks';
import { normalizeThumbnailSizes } from '../../src/lib/responsive-images';
import { formatMarkdownImageDestination, safelyDecodeUriComponent } from '../../src/lib/local-images';
import { type NoteReferenceInput } from '../../src/lib/note-links';
import {
  composeFullSlug,
  getContentImageFolder,
  hyphenateSlug,
  isRouteWinner,
  listVaultFullSlugCandidates,
  applyRewrites,
  toPublicSlug,
} from '../../src/lib/rewrites';
import { collectNoteReferencesForLocalMarkdown, collectPrivateNoteIncludes } from './note-includes';
import { createRawBlockConverter } from './wordpress-raw-blocks';
import { validatePulledMarkdown } from './wordpress-pull-validation';
import { parseContentTaxonomies } from '../../src/lib/content-metadata';
import {
  createWordPressTaxonomyResolver,
  formatTaxonomyFrontmatterLines,
} from './wordpress-taxonomies';


import { computeContentHash, loadSyncState, saveSyncState } from './sync-state';
import { getWordPressSyncStateFromObject, setWordPressEntry, updateWordPressSyncState } from './wordpress-sync-state';
import { computeWordPressPayloadHash, type WordPressPublishPayload } from './wordpress-payload';
import {
  formatWordPressSyncSummary,
  type WordPressSyncErrorResult,
  type WordPressSyncItemResult,
} from './wordpress-sync-log';




interface PushToWordPressArgs {
  site: Site;
  registry: Registry;
  allIndices: Map<string, VaultDirectoryIndex>;
  targetSlugs?: string[];
  force?: boolean;
  markSynced?: boolean;
  dryRun: boolean;
}

interface WpFetchArgs {
  endpoint: string;
  credentials: { username: string; applicationPassword: string };
  path: string;
  method?: string;
  body?: unknown;
}

type WordPressPostPayload = WordPressPublishPayload & {
  date?: string;
};

const WordPressContentTypeSchema = z.enum(['post', 'page']);
const WordPressFrontmatterSchema = z.object({
  wordpress: z.object({
    type: WordPressContentTypeSchema.optional(),
  }).optional(),
}).passthrough();

type WordPressContentType = z.infer<typeof WordPressContentTypeSchema>;
type WordPressRestResource = {
  contentType: WordPressContentType;
  restBase: 'posts' | 'pages';
};

const WORDPRESS_REST_RESOURCES: Record<WordPressContentType, WordPressRestResource> = {
  post: { contentType: 'post', restBase: 'posts' },
  page: { contentType: 'page', restBase: 'pages' },
};

function getWordPressRestResource({
  frontmatter,
}: {
  frontmatter: Record<string, unknown>;
}): WordPressRestResource {
  const result = WordPressFrontmatterSchema.safeParse(frontmatter);
  if (!result.success) {
    throw new Error('Invalid WordPress frontmatter. Expected wordpress.type to be "post" or "page".');
  }

  const contentType = result.data.wordpress?.type || 'post';
  return WORDPRESS_REST_RESOURCES[contentType];
}

function buildNoteReferenceInputs({
  allIndices,
  routes,
}: {
  allIndices: Map<string, VaultDirectoryIndex>;
  routes?: Record<string, string>;
}): NoteReferenceInput[] {
  const noteReferences: NoteReferenceInput[] = [];
  for (const [dirKey, dirIndex] of allIndices.entries()) {
    for (const page of dirIndex.pages) {
      const fullSlug = composeFullSlug({ directory: dirKey, slug: page.slug });
      const publicSlug = page.publicSlug ?? toPublicSlug({ fullSlug });
      noteReferences.push({
        fullSlug,
        title: page.title,
        publicSlug,
        shadowed: routes ? !isRouteWinner({ routes, publicSlug, fullSlug }) : false,
      });
    }
  }
  return noteReferences;
}

async function collectLocalNoteReferences({
  publicNoteReferences,
  privateNoteReferences,
  vaultPath,
  markdown,
}: {
  publicNoteReferences: readonly NoteReferenceInput[];
  privateNoteReferences: readonly NoteReferenceInput[];
  vaultPath: string;
  markdown: string;
}) {
  return collectNoteReferencesForLocalMarkdown({
    publicNoteReferences,
    privateNoteReferences,
    markdown,
    readPublicNote: ({ fullSlug }) => readFile(path.join(vaultPath, 'content', `${fullSlug}.md`), 'utf-8'),
  });
}

/**
 * Performs authenticated requests to the WordPress REST API.
 */
async function wpFetch({
  endpoint,
  credentials,
  path: apiPath,
  method = 'GET',
  body,
}: WpFetchArgs) {
  const url = `${endpoint.replace(/\/+$/, '')}${apiPath}`;
  const auth = Buffer.from(`${credentials.username}:${credentials.applicationPassword}`).toString('base64');

  const headers: Record<string, string> = {
    'Authorization': `Basic ${auth}`,
  };

  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`WordPress API error (${response.status}): ${errorText || response.statusText}`);
  }

  return response.json();
}

/**
 * Iterates through the Markdown posts in the vault and publishes them to WordPress.
 */
export async function pushToWordPress({
  site,
  registry,
  allIndices,
  targetSlugs,
  force,
  markSynced,
  dryRun,
}: PushToWordPressArgs) {
  const credentials = site.wordpress;
  if (!credentials) {
    throw new Error(`⨯ WordPress credentials are not configured for site [${site.siteId}].`);
  }

  const endpoint = credentials.endpoint || `https://${site.domain}/wp-json`;
  const taxonomyResolver = createWordPressTaxonomyResolver({
    request: ({ path: apiPath, method, body }) => wpFetch({
      endpoint,
      credentials,
      path: apiPath,
      method,
      body,
    }),
    createMissingTerms: !dryRun,
  });
  const sizes = normalizeThumbnailSizes(site.thumbnailSizes || registry.thumbnailSizes);
  const imageHost = site.imageHost || registry.imageHost;

  if (!imageHost) {
    throw new Error(`⨯ WordPress publishing requires "imageHost" for externally reachable thumbnail URLs.`);
  }

  console.log(`\n📝 Preparing WordPress Publishing...`);
  console.log(`- Target Endpoint: ${endpoint}`);
  console.log(`- Authenticated As: ${credentials.username}`);
  if (targetSlugs && targetSlugs.length > 0) {
    console.log(`- Target Post Slugs: ${targetSlugs.join(', ')}`);
  }
  if (force) {
    console.log(`- Force Mode: ENABLED (Bypassing publish payload hash checks)`);
  }
  console.log(dryRun ? `- Mode: DRY RUN (No changes will be written)\n` : `- Mode: Live Sync\n`);

  const syncState = await loadSyncState({ vaultPath: site.vaultPath });
  const wpSyncState = getWordPressSyncStateFromObject(syncState);

  let assetFiles: string[] = [];
  let routes: Record<string, string> | undefined;
  try {
    const rootIndexRaw = await readFile(path.join(site.vaultPath, 'root.json'), 'utf-8');
    const parsed = VaultRootIndexSchema.safeParse(JSON.parse(rootIndexRaw));
    if (parsed.success) {
      assetFiles = parsed.data.assetFiles || parsed.data.publicFiles || [];
      routes = parsed.data.routes;
    }
  } catch {
    // If root.json is not found or not yet generated, fallback to empty array
  }

  const postsToPublish: {
    localPath: string;
    slug: string;
    publicSlug: string;
    title: string;
    date: string;
    taxonomies: ReturnType<typeof parseContentTaxonomies>;
  }[] = [];

  for (const [dirKey, dirIndex] of allIndices.entries()) {
    for (const page of dirIndex.pages) {
      const fullSlug = composeFullSlug({ directory: dirKey, slug: page.slug });
      const publicSlug = page.publicSlug ?? toPublicSlug({ fullSlug });
      const isWinner = !routes || isRouteWinner({ routes, publicSlug, fullSlug });
      const isExplicitTarget = Boolean(targetSlugs && targetSlugs.includes(fullSlug));

      if (targetSlugs && targetSlugs.length > 0 && !isExplicitTarget) {
        continue;
      }

      if (!isWinner) {
        if (isExplicitTarget) {
          console.warn(`⚠️  Skipping shadowed post "${fullSlug}" — "${routes?.[publicSlug]}" is served at that public URL.`);
        }
        continue;
      }

      const localPath = path.join(site.vaultPath, 'content', dirKey, `${page.slug}.md`);
      postsToPublish.push({
        localPath,
        slug: fullSlug,
        publicSlug,
        title: page.title,
        date: page.date,
        taxonomies: {
          categories: page.categories,
          tags: page.tags,
        },
      });
    }
  }

  if (targetSlugs && targetSlugs.length > 0) {
    const foundSlugs = new Set(postsToPublish.map((p) => p.slug));
    const missingSlugs = targetSlugs.filter((slug) => !foundSlugs.has(slug));
    if (missingSlugs.length > 0) {
      if (postsToPublish.length === 0) {
        throw new Error(
          `⨯ Could not find any posts in the vault matching slugs: ${targetSlugs
            .map((s) => `"${s}"`)
            .join(', ')}`
        );
      } else {
        console.warn(
          `⚠️ Warning: Could not find posts in the vault matching slugs: ${missingSlugs
            .map((s) => `"${s}"`)
            .join(', ')}`
        );
      }
    }
  }

  console.log(`Found ${postsToPublish.length} post(s) to process.`);

  if (markSynced) {
    console.log(`\n📝 Initializing WordPress Sync State (marking vault posts as synced)...`);
    let markedCount = 0;
    for (const post of postsToPublish) {
      const fileContent = await readFile(post.localPath, 'utf-8');
      const currentHash = computeContentHash(fileContent);
      setWordPressEntry(syncState, post.slug, { contentHash: currentHash });
      markedCount += 1;
      console.log(`  ✓ Marked "${post.title}" (slug: ${post.slug}) as synced.`);
    }

    if (!dryRun && markedCount > 0) {
      await saveSyncState({ vaultPath: site.vaultPath, syncState });
    }
    console.log(`\n✅ Successfully marked ${markedCount} post(s) as synced in .notopress-sync.json.`);
    return;
  }

  const publicNoteReferences = buildNoteReferenceInputs({ allIndices, routes });
  const privateNoteReferences = await collectPrivateNoteIncludes({
    vaultPath: site.vaultPath,
    includePaths: site.noteIncludePaths,
  });
  await taxonomyResolver.preloadPayloads({
    taxonomies: postsToPublish.map((post) => post.taxonomies),
  });

  const updatedPosts: WordPressSyncItemResult[] = [];
  const createdPosts: WordPressSyncItemResult[] = [];
  const failedPosts: WordPressSyncErrorResult[] = [];
  let skippedCount = 0;
  let syncStateChanged = false;

  for (const post of postsToPublish) {
    try {
      // Read markdown and parse frontmatter
      const fileContent = await readFile(post.localPath, 'utf-8');
      const sourceHash = computeContentHash(fileContent);

      const isExplicitTarget = Boolean(targetSlugs && targetSlugs.length > 0);

      console.log(`\nSyncing "${post.title}" (slug: ${post.slug})...`);

      const { data, content: markdownBody } = matter(fileContent);
      const wordpressResource = getWordPressRestResource({ frontmatter: data });
      const contentTaxonomies = parseContentTaxonomies({ frontmatter: data });
      const taxonomyPayload = wordpressResource.contentType === 'post'
        ? await taxonomyResolver.resolvePayload({ taxonomies: contentTaxonomies })
        : {};

      // Strip first H1 from markdown to avoid duplicated titles, only if it's the first non-empty line of the document and not inside a code block
      const lines = markdownBody.split('\n');
      let inCodeBlock = false;
      let firstH1Index = -1;
      
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith('```')) {
          inCodeBlock = !inCodeBlock;
        }
        if (!inCodeBlock && trimmed.startsWith('# ')) {
          firstH1Index = i;
          break;
        }
      }

      if (firstH1Index !== -1) {
        const hasContentBefore = lines.slice(0, firstH1Index).some(line => line.trim() !== '');
        if (!hasContentBefore) {
          lines.splice(firstH1Index, 1);
        }
      }
      const bodyWithoutTitle = lines.join('\n').trim();
      const noteReferences = await collectLocalNoteReferences({
        publicNoteReferences,
        privateNoteReferences,
        vaultPath: site.vaultPath,
        markdown: bodyWithoutTitle,
      });

      // Render Markdown content to HTML
      const htmlContent = await renderMarkdownContent({
        markdown: bodyWithoutTitle,
        thumbnailSizes: sizes,
        assetFiles,
        noteReferences,
        assetUrlConfig: {
          imageHost,
          siteId: site.siteId,
          s3SubDir: 'content',
          mode: 'absolute',
        },
        getFigureProperties: (largestWidth) => {
          return {
            class: 'wp-block-image',
            style: 'height: auto !important;',
          };
        },
        getTableFigureProperties: () => {
          return {
            class: 'wp-block-table is-style-stripes',
          };
        },
      });

      const wordpressBlockContent = serializeHtmlToWordPressBlocks(htmlContent);

      // Replace slashes with hyphens to match WordPress's sanitization behavior
      const wpSlug = hyphenateSlug({ slug: post.publicSlug });
      const legacyWpSlug = hyphenateSlug({ slug: post.slug });

      const payload: WordPressPostPayload = {
        title: post.title,
        content: wordpressBlockContent,
        slug: wpSlug,
        status: 'publish',
        ...taxonomyPayload,
      };
      const payloadHash = computeWordPressPayloadHash({
        contentType: wordpressResource.contentType,
        payload,
      });
      const syncEntry = wpSyncState[post.slug];
      const payloadIsUnchanged = syncEntry?.payloadHash === payloadHash;

      if (!force && !isExplicitTarget && syncEntry && payloadIsUnchanged) {
        if (syncEntry.contentHash !== sourceHash) {
          setWordPressEntry(syncState, post.slug, {
            contentHash: sourceHash,
            payloadHash,
            syncedAt: syncEntry.syncedAt,
          });
          syncStateChanged = true;
        }
        console.log(`  ⏭️  Skipping "${post.title}" (slug: ${post.slug}) - publish payload unchanged.`);
        skippedCount += 1;
        continue;
      }

      const ExistingPostListSchema = z.array(z.object({ id: z.number() }));
      const lookupSlugs = wpSlug === legacyWpSlug ? [wpSlug] : [wpSlug, legacyWpSlug];
      let existingPost: { id: number } | null = null;
      for (const lookupSlug of lookupSlugs) {
        const existingResult = ExistingPostListSchema.safeParse(
          await wpFetch({
            endpoint,
            credentials,
            path: `/wp/v2/${wordpressResource.restBase}?slug=${encodeURIComponent(lookupSlug)}&status=any`,
          })
        );
        if (existingResult.success && existingResult.data.length > 0) {
          existingPost = existingResult.data[0];
          break;
        }
      }

      const wpPostExists = Boolean(existingPost);
      const wpPostId = existingPost?.id ?? null;

      if (wpPostExists) {
        if (dryRun) {
          console.log(`  🔄 [DRY RUN] Would UPDATE WordPress ${wordpressResource.contentType} "${post.title}" (ID: ${wpPostId})`);
        } else {
          await wpFetch({
            endpoint,
            credentials,
            path: `/wp/v2/${wordpressResource.restBase}/${wpPostId}`,
            method: 'POST',
            body: payload,
          });
          console.log(`  🔄 Successfully UPDATED WordPress ${wordpressResource.contentType} (ID: ${wpPostId})`);
        }
        updatedPosts.push({
          title: post.title,
          slug: post.slug,
          action: 'updated',
          contentType: wordpressResource.contentType,
          id: wpPostId,
          isDryRun: dryRun,
        });
      } else {
        let createdId: number | null = null;
        if (dryRun) {
          console.log(`  🆕 [DRY RUN] Would CREATE new WordPress ${wordpressResource.contentType} "${post.title}"`);
        } else {
          const newPost = await wpFetch({
            endpoint,
            credentials,
            path: `/wp/v2/${wordpressResource.restBase}`,
            method: 'POST',
            body: {
              ...payload,
              date: post.date,
            },
          });
          createdId = newPost.id;
          console.log(`  🆕 Successfully CREATED new WordPress ${wordpressResource.contentType} (ID: ${newPost.id})`);
        }
        createdPosts.push({
          title: post.title,
          slug: post.slug,
          action: 'created',
          contentType: wordpressResource.contentType,
          id: createdId,
          isDryRun: dryRun,
        });
      }

      setWordPressEntry(syncState, post.slug, { contentHash: sourceHash, payloadHash });
      syncStateChanged = true;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`  ❌ Failed to sync post "${post.title}":`, errMsg);
      failedPosts.push({
        title: post.title,
        slug: post.slug,
        error: errMsg,
      });
      // We don't want to crash the whole sync if one post fails, but if target slugs are specified, we bubble up
      if (targetSlugs && targetSlugs.length > 0) {
        throw err;
      }
    }
  }

  if (!dryRun && syncStateChanged) {
    await saveSyncState({ vaultPath: site.vaultPath, syncState });
  }

  console.log(
    `\n` +
      formatWordPressSyncSummary({
        updated: updatedPosts,
        created: createdPosts,
        failed: failedPosts,
        skippedCount,
        totalProcessed: postsToPublish.length,
        isDryRun: dryRun,
      })
  );
}

interface WpPost {
  id: number;
  date: string;
  date_gmt?: string;
  modified: string;
  modified_gmt?: string;
  slug: string;
  title: {
    rendered: string;
    raw?: string;
  };
  content: {
    rendered: string;
    raw?: string;
  };
  status: string;
  categories?: number[];
  tags?: number[];
}

const WpPostSchema = z.object({
  id: z.number(),
  date: z.string(),
  date_gmt: z.string().optional(),
  modified: z.string(),
  modified_gmt: z.string().optional(),
  slug: z.string(),
  title: z.object({
    rendered: z.string(),
    raw: z.string().optional(),
  }),
  content: z.object({
    rendered: z.string(),
    raw: z.string().optional(),
  }),
  status: z.string(),
  categories: z.array(z.number()).optional(),
  tags: z.array(z.number()).optional(),
});

const WpPostArraySchema = z.array(WpPostSchema);

export function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rsquo;/g, '’')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&hellip;/g, '…')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, dec) => {
      try {
        return String.fromCodePoint(parseInt(dec, 10));
      } catch {
        return _;
      }
    })
    .replace(/&#x([a-fA-F0-9]+);/g, (_, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return _;
      }
    });
}

export function resolveAndCollectImagePath(
  src: string,
  site: Site,
  registry: Registry,
  slug = '',
  collectedImages?: { remoteUrl: string; tryHighResUrl: string; localPath: string }[]
): string {
  // If it's a relative path already, just return it without leading slash
  if (src.startsWith('/') && !src.startsWith('//') && !src.includes('/api/vault-public/') && !src.includes('_thumbnails/')) {
    return src.replace(/^\//, '');
  }

  let tempPath = src;
  let isExternal = false;
  const originalUrl = src;

  // Check if it is an external URL
  if (tempPath.startsWith('http://') || tempPath.startsWith('https://')) {
    try {
      const urlObj = new URL(tempPath);
      const isInternal = 
        tempPath.includes('_thumbnails/') || 
        tempPath.includes('/api/vault-public/') ||
        (site.domain && urlObj.hostname === site.domain) ||
        (site.imageHost && urlObj.hostname === new URL(site.imageHost).hostname) ||
        (registry.imageHost && urlObj.hostname === new URL(registry.imageHost).hostname);

      if (!isInternal) {
        isExternal = true;
      }
      tempPath = urlObj.pathname;
    } catch {
      isExternal = true;
    }
  }

  // Remove leading slash
  tempPath = tempPath.replace(/^\//, '');

  // Strip query parameters and hash from tempPath
  const questionMarkIndex = tempPath.indexOf('?');
  if (questionMarkIndex !== -1) {
    tempPath = tempPath.substring(0, questionMarkIndex);
  }
  const hashIndex = tempPath.indexOf('#');
  if (hashIndex !== -1) {
    tempPath = tempPath.substring(0, hashIndex);
  }

  // If it goes through api/vault-public
  if (tempPath.startsWith('api/vault-public/')) {
    tempPath = tempPath.substring('api/vault-public/'.length);
  }

  // If it has siteId prefix (e.g. test-blog/content/...)
  const siteIdPrefix = `${site.siteId}/`;
  if (tempPath.startsWith(siteIdPrefix)) {
    tempPath = tempPath.substring(siteIdPrefix.length);
    if (tempPath.startsWith('content/')) {
      tempPath = tempPath.substring('content/'.length);
    } else if (tempPath.startsWith('public/')) {
      tempPath = tempPath.substring('public/'.length);
    }
  }

  // Extract filename
  const filename = tempPath.split('/').pop() || '';
  if (!filename) return src;

  // Extract base name and extension to find original files
  const ext = path.extname(filename);
  const baseName = path.basename(filename, ext);
  const cleanBaseName = baseName.replace(/-(\d+x\d+|\d+)$/, '');
  const decodedBaseName = safelyDecodeUriComponent({ value: cleanBaseName });
  const finalFilename = `${decodedBaseName}${ext}`;

  // Check if the file already exists locally
  const dir = path.dirname(tempPath);
  const candidateFolders = slug 
    ? [slug] 
    : ['attachments', 'images', dir !== '.' ? dir : '', ''];
  const extensions = [ext, '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif'];

  for (const folder of candidateFolders) {
    for (const curExt of extensions) {
      const checkFilename = `${decodedBaseName}${curExt}`;
      const relPath = folder ? `${folder}/${checkFilename}` : checkFilename;
      
      const publicPath = path.join(site.vaultPath, 'public', relPath);
      const contentPath = path.join(site.vaultPath, 'content', relPath);
      
      if (existsSync(publicPath)) {
        return relPath;
      }
      if (existsSync(contentPath)) {
        return relPath;
      }
    }
  }

  // If it contains _thumbnails, extract path
  const thumbIndex = tempPath.indexOf('_thumbnails/');
  if (thumbIndex !== -1) {
    tempPath = tempPath.substring(thumbIndex + '_thumbnails/'.length);
    const match = tempPath.match(/(.+)-\d+\.webp$/);
    const encodedPathWithoutThumbExt = match ? match[1] : tempPath.replace(/\.[^/.]+$/, "");
    const pathWithoutThumbExt = safelyDecodeUriComponent({ value: encodedPathWithoutThumbExt });

    for (const curExt of extensions) {
      const publicPath = path.join(site.vaultPath, 'public', `${pathWithoutThumbExt}${curExt}`);
      const contentPath = path.join(site.vaultPath, 'content', `${pathWithoutThumbExt}${curExt}`);
      if (existsSync(publicPath)) {
        return `${pathWithoutThumbExt}${curExt}`;
      }
      if (existsSync(contentPath)) {
        return `${pathWithoutThumbExt}${curExt}`;
      }
    }
  }

  // If not found locally, we queue it for download
  const targetLocalPath = slug ? `${slug}/${finalFilename}` : `attachments/${finalFilename}`;
  const targetFullPath = path.join(site.vaultPath, 'content', targetLocalPath);

  if (collectedImages) {
    let tryHighResUrl = originalUrl;
    if (originalUrl.includes(filename)) {
      tryHighResUrl = originalUrl.replace(filename, finalFilename);
    }
    const isAlreadyCollected = collectedImages.some((image) => image.localPath === targetFullPath);
    if (!isAlreadyCollected) {
      collectedImages.push({
        remoteUrl: originalUrl,
        tryHighResUrl,
        localPath: targetFullPath,
      });
    }
  }

  return targetLocalPath;
}

export function restoreLocalImagePath(src: string, site: Site, registry: Registry): string {
  return resolveAndCollectImagePath(src, site, registry);
}

export function htmlToMarkdown(
  html: string,
  site: Site,
  registry: Registry,
  slug = '',
  collectedImages?: { remoteUrl: string; tryHighResUrl: string; localPath: string }[]
): string {
  // Strip script tags, standard HTML comments, and core Gutenberg block comments (e.g. wp:paragraph)
  // while preserving custom/namespaced Gutenberg block comments (e.g. wp:namespace/example-block)
  const coreBlocksPattern = '(?:paragraph|heading|image|list|quote|table|code|html|freeform)\\b';
  const cleanHtml = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(new RegExp(`<!--(?!\\s*\\/?wp:(?!${coreBlocksPattern})[a-zA-Z0-9_-]+(?:\\/[a-zA-Z0-9_-]+)?\\b)[\\s\\S]*?-->`, 'gi'), '');

  // Tokenize the HTML
  const tagRegex = /(<\/?[a-zA-Z0-9:-]+(?:\s+[a-zA-Z0-9:-]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>)/g;
  const parts = cleanHtml.split(tagRegex);
  
  interface Node {
    type: string;
    attributes: Record<string, string>;
    children: Node[];
    text?: string;
  }

  const root: Node = { type: 'root', attributes: {}, children: [] };
  const stack: Node[] = [root];

  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('<!--') && part.endsWith('-->')) {
      stack[stack.length - 1].children.push({ type: 'text', attributes: {}, children: [], text: part });
    } else if (part.startsWith('<') && part.endsWith('>')) {
      const isClosing = part.startsWith('</');
      const tagContent = part.replace(/^<\/?/, '').replace(/\/?>$/, '').trim();
      const tagName = tagContent.split(/\s+/)[0].toLowerCase();
      
      const isSelfClosing = part.endsWith('/>') || /^(?:img|br|hr|input|meta|link)$/i.test(tagName);
      
      if (isClosing) {
        const openIdx = [...stack].reverse().findIndex(n => n.type === tagName);
        if (openIdx !== -1) {
          const actualIdx = stack.length - 1 - openIdx;
          stack.splice(actualIdx);
        }
      } else {
        const attributes: Record<string, string> = {};
        const attrRegex = /([a-zA-Z0-9:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
        let match;
        const attrString = tagContent.substring(tagName.length);
        while ((match = attrRegex.exec(attrString)) !== null) {
          const key = match[1].toLowerCase();
          const value = match[2] ?? match[3] ?? match[4] ?? '';
          attributes[key] = value;
        }

        const node: Node = { type: tagName, attributes, children: [] };
        stack[stack.length - 1].children.push(node);

        if (!isSelfClosing) {
          stack.push(node);
        }
      }
    } else {
      const text = decodeHtmlEntities(part);
      if (text) {
        stack[stack.length - 1].children.push({ type: 'text', attributes: {}, children: [], text });
      }
    }
  }

  function render(node: Node, listDepth = 0): string {
    if (node.type === 'text') {
      return node.text || '';
    }

    function renderTable(tableNode: Node): string {
      const rows: Node[] = [];
      function collectRows(currentNode: Node): void {
        if (currentNode.type === 'tr') rows.push(currentNode);
        for (const child of currentNode.children) collectRows(child);
      }
      collectRows(tableNode);

      const renderedRows = rows.map((row) => {
        const cells = row.children.filter((child) => child.type === 'th' || child.type === 'td');
        const values = cells.map((cell) => cell.children
          .map((child) => render(child, listDepth))
          .join('')
          .trim()
          .replace(/\s*\n\s*/g, ' ')
          .replace(/\|/g, '\\|'));
        return { values, isHeader: cells.some((cell) => cell.type === 'th') };
      }).filter((row) => row.values.length > 0);

      if (renderedRows.length === 0) return '';
      const headerIndex = renderedRows.findIndex((row) => row.isHeader);
      const effectiveHeaderIndex = headerIndex === -1 ? 0 : headerIndex;
      const header = renderedRows[effectiveHeaderIndex];
      const bodyRows = renderedRows.filter((_row, index) => index !== effectiveHeaderIndex);
      return [
        `| ${header.values.join(' | ')} |`,
        `| ${header.values.map(() => '---').join(' | ')} |`,
        ...bodyRows.map((row) => `| ${row.values.join(' | ')} |`),
      ].join('\n');
    }

    if (node.type === 'figure') {
      const image = findNodeByType(node, 'img');
      if (image) {
        const src = image.attributes['src'] || '';
        const alt = image.attributes['alt'] || '';
        const figcaption = findNodeByType(node, 'figcaption');
        const captionMarkdown = figcaption ? `\n\n*${render(figcaption, listDepth).trim()}*` : '';
        const localSrc = resolveAndCollectImagePath(src, site, registry, slug, collectedImages);
        return `\n\n![${alt}](${formatMarkdownImageDestination({ src: localSrc })})${captionMarkdown}\n\n`;
      }

      const table = findNodeByType(node, 'table');
      if (table) {
        const caption = findNodeByType(node, 'figcaption') || findNodeByType(table, 'caption');
        const captionMarkdown = caption ? `\n\n*${render(caption, listDepth).trim()}*` : '';
        return `\n\n${renderTable(table)}${captionMarkdown}\n\n`;
      }
    }

    if (node.type === 'table') {
      const caption = findNodeByType(node, 'caption');
      const captionMarkdown = caption ? `\n\n*${render(caption, listDepth).trim()}*` : '';
      return `\n\n${renderTable(node)}${captionMarkdown}\n\n`;
    }

    const childrenContent = node.children.map(c => render(c, listDepth)).join('');

    switch (node.type) {
      case 'root':
        return childrenContent.trim();
      case 'p':
        return `\n\n${childrenContent.trim()}\n\n`;
      case 'h1':
        return `\n\n# ${childrenContent.trim()}\n\n`;
      case 'h2':
        return `\n\n## ${childrenContent.trim()}\n\n`;
      case 'h3':
        return `\n\n### ${childrenContent.trim()}\n\n`;
      case 'h4':
        return `\n\n#### ${childrenContent.trim()}\n\n`;
      case 'h5':
        return `\n\n##### ${childrenContent.trim()}\n\n`;
      case 'h6':
        return `\n\n###### ${childrenContent.trim()}\n\n`;
      case 'strong':
      case 'b':
        return `**${childrenContent}**`;
      case 'em':
      case 'i':
        return `*${childrenContent}*`;
      case 'code':
        return `\`${childrenContent}\``;
      case 'pre': {
        const codeNode = node.children.find(c => c.type === 'code');
        const codeText = codeNode ? codeNode.children.map(c => render(c, listDepth)).join('') : childrenContent;
        const className = codeNode?.attributes['class'] || node.attributes['class'] || '';
        const langMatch = className.match(/language-([a-zA-Z0-9+-]+)/);
        const lang = langMatch ? langMatch[1] : '';
        return `\n\n\`\`\`${lang}\n${codeText.trim()}\n\`\`\`\n\n`;
      }
      case 'blockquote':
        return `\n\n> ${childrenContent.trim().replace(/\n/g, '\n> ')}\n\n`;
      case 'ul': {
        const childrenToRender = node.children.filter(c => c.type !== 'text' || (c.text && c.text.trim() !== ''));
        const content = childrenToRender.map(c => render(c, listDepth + 1)).join('');
        if (listDepth > 0) {
          return `\n${content.trimEnd()}`;
        }
        return `\n\n${content.trim()}\n\n`;
      }
      case 'ol': {
        let index = 1;
        const childrenToRender = node.children.filter(c => c.type !== 'text' || (c.text && c.text.trim() !== ''));
        const content = childrenToRender.map(c => {
          if (c.type === 'li') {
            return render(c, listDepth + 1).replace(/^(\s*)-\s+/, `$1${index++}. `);
          }
          return render(c, listDepth + 1);
        }).join('');
        if (listDepth > 0) {
          return `\n${content.trimEnd()}`;
        }
        return `\n\n${content.trim()}\n\n`;
      }
      case 'li': {
        const indent = '  '.repeat(Math.max(0, listDepth - 1));
        return `${indent}- ${childrenContent.trim()}\n`;
      }
      case 'a':
        const href = node.attributes['href'] || '';
        return `[${childrenContent}](${href})`;
      case 'img': {
        const src = node.attributes['src'] || '';
        const alt = node.attributes['alt'] || '';
        const localSrc = resolveAndCollectImagePath(src, site, registry, slug, collectedImages);
        return `![${alt}](${formatMarkdownImageDestination({ src: localSrc })})`;
      }
      case 'caption':
        return childrenContent;
      case 'thead':
      case 'tbody':
        return childrenContent;
      case 'tr': {
        const cells = node.children.filter(c => c.type === 'th' || c.type === 'td');
        const rowText = `| ${cells.map(c => render(c, listDepth)).join(' | ')} |\n`;
        const isHeader = cells.some(c => c.type === 'th');
        if (isHeader) {
          const sepRow = `| ${cells.map(() => '---').join(' | ')} |\n`;
          return `${rowText}${sepRow}`;
        }
        return rowText;
      }
      case 'th':
      case 'td':
        return childrenContent.trim().replace(/\n/g, ' ');
      case 'figcaption':
        return childrenContent;
      case 'br':
        return '\n';
      case 'hr':
        return '\n\n---\n\n';
      default:
        return childrenContent;
    }
  }

  function findNodeByType(node: Node, type: string): Node | null {
    if (node.type === type) return node;
    for (const child of node.children) {
      const found = findNodeByType(child, type);
      if (found) return found;
    }
    return null;
  }

  function getPlainText(node: Node): string {
    if (node.type === 'text') return node.text || '';
    return node.children.map(getPlainText).join('');
  }

  const result = render(root);
  return result
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface PullFromWordPressArgs {
  site: Site;
  registry: Registry;
  slugOrId: string;
  dryRun: boolean;
}

function findLocalPullTarget({
  site,
  slugOrId,
  wpSlug,
}: {
  site: Site;
  slugOrId: string;
  wpSlug: string;
}): { localPath: string; canonicalSlug: string; matchedExisting: boolean } {
  const candidates = listVaultFullSlugCandidates({
    slugOrId,
    wpSlug,
    rules: site.rewrites,
  });

  for (const fullSlug of candidates) {
    const localPath = path.join(site.vaultPath, 'content', `${fullSlug}.md`);
    if (existsSync(localPath)) {
      return { localPath, canonicalSlug: fullSlug, matchedExisting: true };
    }
  }

  return {
    localPath: path.join(site.vaultPath, 'content', `${wpSlug}.md`),
    canonicalSlug: wpSlug,
    matchedExisting: false,
  };
}

export async function pullFromWordPress({
  site,
  registry,
  slugOrId,
  dryRun,
}: PullFromWordPressArgs) {
  const credentials = site.wordpress;
  if (!credentials) {
    throw new Error(`⨯ WordPress credentials are not configured for site [${site.siteId}].`);
  }

  const endpoint = credentials.endpoint || `https://${site.domain}/wp-json`;
  const taxonomyResolver = createWordPressTaxonomyResolver({
    request: ({ path: apiPath }) => wpFetch({ endpoint, credentials, path: apiPath }),
  });
  console.log(`\n📥 Preparing WordPress Pull...`);
  console.log(`- Target Endpoint: ${endpoint}`);
  console.log(`- Authenticated As: ${credentials.username}`);
  console.log(`- Target Post Slug/ID: ${slugOrId}`);
  console.log(dryRun ? `- Mode: DRY RUN (No changes will be written)\n` : `- Mode: Live Pull\n`);

  let wpPost: WpPost | null = null;
  const fetchSlugs = [hyphenateSlug({ slug: slugOrId })];
  const rewrittenPublicSlug = applyRewrites({
    fullSlug: slugOrId.replace(/^\//, ''),
    rules: site.rewrites,
  });
  const rewrittenWpSlug = hyphenateSlug({ slug: rewrittenPublicSlug });
  if (!fetchSlugs.includes(rewrittenWpSlug)) {
    fetchSlugs.push(rewrittenWpSlug);
  }

  for (const fetchSlug of fetchSlugs) {
    try {
      const postsResult = WpPostArraySchema.safeParse(
        await wpFetch({
          endpoint,
          credentials,
          path: `/wp/v2/posts?slug=${encodeURIComponent(fetchSlug)}&status=any&context=edit`,
        })
      );
      if (postsResult.success && postsResult.data.length > 0) {
        wpPost = postsResult.data[0];
        break;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('401') || errMsg.includes('403')) {
        throw new Error(`⨯ WordPress authentication failed: ${errMsg}`);
      }
      console.log(`  (Slug lookup for "${fetchSlug}" failed: ${errMsg}. Checking ID...)`);
    }
  }

  if (!wpPost && /^\d+$/.test(slugOrId)) {
    try {
      const postResult = WpPostSchema.safeParse(
        await wpFetch({
          endpoint,
          credentials,
          path: `/wp/v2/posts/${slugOrId}?context=edit`,
        })
      );
      if (postResult.success) {
        wpPost = postResult.data;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('401') || errMsg.includes('403')) {
        throw new Error(`⨯ WordPress authentication failed: ${errMsg}`);
      }
    }
  }

  if (!wpPost) {
    throw new Error(`⨯ Could not find any post in WordPress matching slug or ID: "${slugOrId}"`);
  }

  const rawTitle = wpPost.title.raw || wpPost.title.rendered;

  console.log(`✅ Found post: "${rawTitle}" (ID: wpPost ID: ${wpPost.id}, Slug: ${wpPost.slug})`);

  const pullTarget = findLocalPullTarget({ site, slugOrId, wpSlug: wpPost.slug });
  const imageFolder = pullTarget.matchedExisting
    ? getContentImageFolder({ fullSlug: pullTarget.canonicalSlug })
    : wpPost.slug;
  if (!pullTarget.matchedExisting && site.rewrites && site.rewrites.length > 0) {
    console.warn(
      `⚠️  No local Markdown file matched this WordPress post. Creating it at content root because rewrite folders cannot be inferred from WordPress.`
    );
  }

  const collectedImages: { remoteUrl: string; tryHighResUrl: string; localPath: string }[] = [];
  const convertHtml = ({ html }: { html: string }) => htmlToMarkdown(
    html,
    site,
    registry,
    imageFolder,
    collectedImages
  );
  let markdownBody: string;
  if (typeof wpPost.content.raw === 'string') {
    const convertRawBlocks = createRawBlockConverter({
      parseBlocks: ({ content }) => {
        const parsedBlocks: unknown = parseWordPressBlocks(content);
        return parsedBlocks;
      },
      convertHtml,
    });
    const conversion = convertRawBlocks({ content: wpPost.content.raw });
    markdownBody = conversion.markdown;
    if (conversion.preservedBlockNames.length > 0) {
      console.log(`  ℹ️ Preserved unsupported or dynamic blocks: ${conversion.preservedBlockNames.join(', ')}`);
    }
  } else {
    markdownBody = convertHtml({ html: wpPost.content.rendered });
  }
  validatePulledMarkdown({
    sourceContent: wpPost.content.raw ?? wpPost.content.rendered,
    markdown: markdownBody,
  });

  // Parse Date GMT to prevent timezone shifting
  function parseWpDate(dateStr: string, dateGmtStr?: string): string {
    if (dateGmtStr && dateGmtStr !== '0000-00-00T00:00:00') {
      const formatted = dateGmtStr.endsWith('Z') ? dateGmtStr : `${dateGmtStr}Z`;
      return new Date(formatted).toISOString();
    }
    return new Date(dateStr).toISOString();
  }

  const dateIso = parseWpDate(wpPost.date, wpPost.date_gmt);
  const modifiedIso = parseWpDate(wpPost.modified, wpPost.modified_gmt);
  const decodedTitle = decodeHtmlEntities(rawTitle);
  const contentTaxonomies = await taxonomyResolver.resolveFrontmatter({
    categoryIds: wpPost.categories || [],
    tagIds: wpPost.tags || [],
  });

  // Prepend frontmatter while preserving the WordPress body as-is.
  const frontmatter = [
    `---`,
    `title: "${decodedTitle.replace(/"/g, '\\"')}"`,
    `date: "${dateIso}"`,
    `updated: "${modifiedIso}"`,
    ...formatTaxonomyFrontmatterLines({ taxonomies: contentTaxonomies }),
    `---`,
    markdownBody,
    ``,
  ].join('\n');

  const targetLocalPath = pullTarget.localPath;
  const canonicalSlug = pullTarget.canonicalSlug;

  if (dryRun) {
    console.log(`  [DRY RUN] Would write Markdown post for "${wpPost.title.rendered}" to:`);
    console.log(`  📂 ${targetLocalPath}`);
    if (collectedImages.length > 0) {
      console.log(`\n  [DRY RUN] Would download ${collectedImages.length} image(s):`);
      for (const img of collectedImages) {
        console.log(`  - ${img.tryHighResUrl} -> ${img.localPath}`);
      }
    }
    console.log(`\n--- PREVIEW START ---`);
    console.log(frontmatter);
    console.log(`--- PREVIEW END ---`);
  } else {
    // Ensure parent directory exists
    await mkdir(path.dirname(targetLocalPath), { recursive: true });

    // Download collected images
    if (collectedImages.length > 0) {
      console.log(`\n📥 Downloading ${collectedImages.length} image(s) to local vault...`);
      for (const img of collectedImages) {
        try {
          await mkdir(path.dirname(img.localPath), { recursive: true });
          console.log(`- Fetching image: ${img.tryHighResUrl}`);
          let imgResponse = await fetch(img.tryHighResUrl);
          
          if (!imgResponse.ok) {
            console.log(`  (High-res URL failed, falling back to original: ${img.remoteUrl})`);
            imgResponse = await fetch(img.remoteUrl);
          }

          if (!imgResponse.ok) {
            console.error(`  ❌ Failed to download image from both URLs: ${imgResponse.statusText}`);
            continue;
          }

          const buffer = Buffer.from(await imgResponse.arrayBuffer());
          await writeFile(img.localPath, buffer);
          console.log(`  ✅ Saved to: ${img.localPath}`);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`  ❌ Failed to download image "${img.remoteUrl}":`, errMsg);
        }
      }
    }

    await writeFile(targetLocalPath, frontmatter, 'utf-8');
    console.log(`\n  💾 Successfully pulled and saved post to: ${targetLocalPath}`);

    await updateWordPressSyncState({
      vaultPath: site.vaultPath,
      slug: canonicalSlug,
      contentHash: computeContentHash(frontmatter),
    });
    console.log(`  ✓ Updated sync state for "${canonicalSlug}" in .notopress-sync.json`);
  }
}
