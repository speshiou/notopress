import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { z } from 'zod';
import { parse as parseWordPressBlocks } from '@wordpress/block-serialization-default-parser';
import { Site, Registry } from '../../../src/domain/registry';
import { VaultDirectoryIndex, VaultRootIndex, VaultRootIndexSchema } from '../../../src/lib/vault';
import { renderMarkdownContent } from '../../../src/lib/markdown';
import { serializeHtmlToWordPressBlocks } from './blocks';
import { normalizeThumbnailSizes } from '../../../src/lib/responsive-images';
import { formatMarkdownImageDestination, safelyDecodeUriComponent } from '../../../src/lib/local-images';
import { type NoteReferenceInput } from '../../../src/lib/note-links';
import {
  getContentImageFolder,
  hyphenateSlug,
  listVaultFullSlugCandidates,
  applyRewrites,
} from '../../../src/lib/rewrites';
import { collectNoteReferencesForLocalMarkdown, collectPrivateNoteIncludes } from '../../core/content/note-includes';
import { createRawBlockConverter } from './raw-blocks';
import { validateImportedMarkdown } from './import-validation';
import {
  createWordPressTaxonomyResolver,
  formatTaxonomyFrontmatterLines,
} from './taxonomies';


import { computeContentHash, loadSyncState, saveSyncState } from '../../core/state/sync-state';
import {
  getWordPressPublicationStateFromObject,
  setWordPressPublicationStateEntry,
  type WordPressPublicationStateEntry,
  updateWordPressPublicationState,
} from './publication-state';
import {
  computeWordPressPayloadHash,
  createWordPressPublishPayload,
} from './publish-payload';
import { computeWordPressPublicationInputHash } from './publication-input';
import { findWordPressPostIds, getWordPressPostId } from './remote-posts';
import {
  createWordPressPublishPlan,
  formatWordPressPublishPlan,
  type WordPressPublishOperation,
} from './publish-plan';
import {
  formatWordPressPublicationSummary,
  type WordPressPublicationErrorResult,
  type WordPressPublicationItemResult,
} from './publication-summary';
import {
  buildContentSnapshot,
  findSnapshotDocument,
  type ContentSnapshot,
  type ContentSnapshotDocument,
} from '../../core/content/content-snapshot';
import {
  applyPreparedPublication,
  assertPublicationTargetFingerprint,
  type PreparedPublication,
} from '../../core/publishing/platform-adapter';
import { mapWithConcurrency } from '../../core/concurrency';




interface PublishToWordPressInput {
  site: Site;
  registry: Registry;
  allIndices: Map<string, VaultDirectoryIndex>;
  contentSnapshot?: ContentSnapshot;
  rootIndex?: VaultRootIndex;
  targetSlugs?: string[];
  force?: boolean;
  initializeState?: boolean;
  expectedPlanFingerprint?: string;
  dryRun: boolean;
  verbose?: boolean;
}

type PrepareWordPressPublicationInput = Omit<PublishToWordPressInput, 'expectedPlanFingerprint'>;

type LocallyPreparedWordPressOperation = Omit<WordPressPublishOperation, 'action' | 'existingPostId'> & {
  publicationEntry: WordPressPublicationStateEntry | undefined;
  skip: boolean;
};

interface WpFetchArgs {
  endpoint: string;
  credentials: { username: string; applicationPassword: string };
  path: string;
  method?: string;
  body?: unknown;
}

const WordPressContentTypeSchema = z.enum(['post', 'page']);
const WordPressMutationResponseSchema = z.object({
  id: z.number(),
  link: z.string().optional(),
  slug: z.string().optional(),
  status: z.string().optional(),
});
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

function buildWordPressNoteReferenceInputs({
  contentSnapshot,
}: {
  contentSnapshot: ContentSnapshot;
}): NoteReferenceInput[] {
  return contentSnapshot.documents.map((document) => ({
    fullSlug: document.sourceSlug,
    title: document.title,
    publicSlug: document.leafSlug,
    shadowed: false,
  }));
}

async function collectLocalNoteReferences({
  publicNoteReferences,
  privateNoteReferences,
  contentSnapshot,
  markdown,
}: {
  publicNoteReferences: readonly NoteReferenceInput[];
  privateNoteReferences: readonly NoteReferenceInput[];
  contentSnapshot: ContentSnapshot;
  markdown: string;
}) {
  return collectNoteReferencesForLocalMarkdown({
    publicNoteReferences,
    privateNoteReferences,
    markdown,
    readPublicNote: async ({ fullSlug }) => {
      const document = findSnapshotDocument({ snapshot: contentSnapshot, sourceSlug: fullSlug });
      if (!document) {
        throw new Error(`Could not find embedded public note "${fullSlug}" in the content snapshot.`);
      }
      return document.rawSource;
    },
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
export async function prepareWordPressPublication({
  site,
  registry,
  allIndices,
  contentSnapshot,
  rootIndex,
  targetSlugs,
  force,
  initializeState,
  dryRun,
  verbose = false,
}: PrepareWordPressPublicationInput): Promise<PreparedPublication<WordPressPublishOperation> | null> {
  const credentials = site.wordpress;
  if (!credentials) {
    throw new Error(`⨯ WordPress credentials are not configured for site [${site.siteId}].`);
  }

  const endpoint = credentials.endpoint || `https://${site.domain}/wp-json`;
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
  console.log(dryRun ? `- Mode: DRY RUN (No changes will be written)\n` : `- Mode: Live Publication\n`);

  const syncState = await loadSyncState({ vaultPath: site.vaultPath });
  const wordpressPublicationState = getWordPressPublicationStateFromObject(syncState);
  const snapshot = contentSnapshot || await buildContentSnapshot({ vaultPath: site.vaultPath, allIndices });

  let assetFiles = rootIndex?.assetFiles || rootIndex?.publicFiles || [];
  let responsiveImageWidths = rootIndex?.responsiveImageWidths;
  if (!rootIndex) {
    try {
      const rootIndexRaw = await readFile(path.join(site.vaultPath, 'root.json'), 'utf-8');
      const parsed = VaultRootIndexSchema.safeParse(JSON.parse(rootIndexRaw));
      if (parsed.success) {
        assetFiles = parsed.data.assetFiles || parsed.data.publicFiles || [];
        responsiveImageWidths = parsed.data.responsiveImageWidths;
      }
    } catch {
      // If root.json is not found or not yet generated, fallback to empty asset and route data.
    }
  }

  const postsToPublish: {
    document: ContentSnapshotDocument;
    slug: string;
    wordpressSlug: string;
    title: string;
    date: string;
    taxonomies: ContentSnapshotDocument['taxonomies'];
  }[] = [];

  for (const document of snapshot.documents) {
    const isExplicitTarget = Boolean(targetSlugs && targetSlugs.includes(document.sourceSlug));

    if (targetSlugs && targetSlugs.length > 0 && !isExplicitTarget) {
      continue;
    }

    postsToPublish.push({
      document,
      slug: document.sourceSlug,
      wordpressSlug: document.leafSlug,
      title: document.title,
      date: document.date,
      taxonomies: document.taxonomies,
    });
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

  const publicNoteReferences = buildWordPressNoteReferenceInputs({ contentSnapshot: snapshot });
  const privateNoteReferences = await collectPrivateNoteIncludes({
    vaultPath: site.vaultPath,
    includePaths: site.noteIncludePaths,
  });
  const updatedPosts: WordPressPublicationItemResult[] = [];
  const createdPosts: WordPressPublicationItemResult[] = [];
  const failedPosts: WordPressPublicationErrorResult[] = [];
  const plannedOperations: WordPressPublishOperation[] = [];
  let syncStateChanged = false;
  const isExplicitTarget = Boolean(targetSlugs && targetSlugs.length > 0);
  const localOperations = await mapWithConcurrency({
    items: postsToPublish,
    concurrency: 8,
    worker: async (post): Promise<LocallyPreparedWordPressOperation | null> => {
      try {
        const sourceHash = post.document.sourceHash;
        const wordpressResource = getWordPressRestResource({ frontmatter: post.document.frontmatter });
        const noteReferences = await collectLocalNoteReferences({
          publicNoteReferences,
          privateNoteReferences,
          contentSnapshot: snapshot,
          markdown: post.document.markdown,
        });
        const wpSlug = hyphenateSlug({ slug: post.wordpressSlug });
        const publicationEntry = wordpressPublicationState[post.slug];
        const inputHash = computeWordPressPublicationInputHash({
          sourceHash,
          markdown: post.document.markdown,
          title: post.title,
          wordpressSlug: wpSlug,
          contentType: wordpressResource.contentType,
          taxonomies: post.document.taxonomies,
          noteReferences,
          siteId: site.siteId,
          imageHost,
          thumbnailSizes: sizes,
          assetFiles,
          responsiveImageWidths,
        });
        const baseOperation = {
          sourceSlug: post.slug,
          wordpressSlug: wpSlug,
          title: post.title,
          date: post.date,
          contentType: wordpressResource.contentType,
          restBase: wordpressResource.restBase,
          sourceHash,
          inputHash,
          publicationEntry,
        };

        if (
          !force
          && !isExplicitTarget
          && publicationEntry?.inputHash === inputHash
          && publicationEntry.payloadHash
        ) {
          if (verbose) {
            console.log(`  ⏭️  Skipping "${post.title}" (slug: ${post.slug}) - publication inputs unchanged.`);
          }
          return {
            ...baseOperation,
            payloadHash: publicationEntry.payloadHash,
            skip: true,
          };
        }

        const htmlContent = await renderMarkdownContent({
          markdown: post.document.markdown,
          thumbnailSizes: sizes,
          assetFiles,
          responsiveImageWidths,
          noteReferences,
          assetUrlConfig: {
            imageHost,
            siteId: site.siteId,
            s3SubDir: 'content',
            mode: 'absolute',
          },
          getFigureProperties: () => ({
            class: 'wp-block-image',
            style: 'height: auto !important;',
          }),
          getTableFigureProperties: () => ({
            class: 'wp-block-table is-style-stripes',
          }),
        });
        const intent = {
          title: post.title,
          content: serializeHtmlToWordPressBlocks(htmlContent),
          slug: wpSlug,
          status: 'publish' as const,
          taxonomies: wordpressResource.contentType === 'post' ? post.document.taxonomies : {},
        };
        const payloadHash = computeWordPressPayloadHash({
          contentType: wordpressResource.contentType,
          intent,
        });
        const payloadIsUnchanged = publicationEntry?.payloadHash === payloadHash;
        if (!force && !isExplicitTarget && publicationEntry && payloadIsUnchanged) {
          return { ...baseOperation, payloadHash, skip: true };
        }

        const changeReason = publicationEntry?.contentHash === sourceHash
          ? 'rendered publication changed'
          : 'source changed';
        if (!initializeState) {
          console.log(`\nPlanning "${post.title}" (slug: ${post.slug}) — ${changeReason}...`);
        }
        return { ...baseOperation, payloadHash, intent, skip: false };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`  ❌ Failed to plan post "${post.title}":`, errMsg);
        failedPosts.push({ title: post.title, slug: post.slug, error: errMsg });
        if (isExplicitTarget) throw err;
        return null;
      }
    },
  });

  if (initializeState) {
    if (failedPosts.length > 0) {
      throw new Error(
        `WordPress publication state initialization is incomplete because ${failedPosts.length} post(s) failed during planning.`
      );
    }

    console.log(`\n📝 Initializing WordPress publication state from current rendered payloads...`);
    let markedCount = 0;
    for (const operation of localOperations) {
      if (!operation) continue;
      const publicationEntry = operation.publicationEntry;
      setWordPressPublicationStateEntry(syncState, operation.sourceSlug, {
        contentHash: operation.sourceHash,
        inputHash: operation.inputHash,
        payloadHash: operation.payloadHash,
        remoteId: publicationEntry?.remoteId,
        remoteSlug: publicationEntry?.remoteSlug,
        contentType: publicationEntry?.contentType,
      });
      markedCount += 1;
      if (verbose) {
        console.log(`  ✓ Initialized "${operation.title}" (slug: ${operation.sourceSlug}).`);
      }
    }

    if (!dryRun && markedCount > 0) {
      await saveSyncState({ vaultPath: site.vaultPath, syncState });
    }
    const action = dryRun ? 'Would initialize' : 'Initialized';
    console.log(`\n✅ ${action} publication state for ${markedCount} post(s) in .notopress-sync.json.`);
    return null;
  }

  const remoteLookups = localOperations
    .filter((operation): operation is LocallyPreparedWordPressOperation => Boolean(operation && !operation.skip))
    .filter((operation) => {
      const entry = operation.publicationEntry;
      return !(entry?.remoteId
        && (!entry.remoteSlug || entry.remoteSlug === operation.wordpressSlug)
        && (!entry.contentType || entry.contentType === operation.contentType));
    })
    .map((operation) => ({ restBase: operation.restBase, slug: operation.wordpressSlug }));
  let discoveredPostIds: ReadonlyMap<string, number>;
  try {
    discoveredPostIds = await findWordPressPostIds({
      locators: remoteLookups,
      request: ({ path: apiPath }) => wpFetch({ endpoint, credentials, path: apiPath }),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`WordPress publish plan is incomplete because remote discovery failed: ${message}`);
  }

  for (const operation of localOperations) {
    if (!operation) continue;
    const { publicationEntry, skip: shouldSkip, ...preparedOperation } = operation;
    if (shouldSkip) {
      plannedOperations.push({
        ...preparedOperation,
        action: 'skip',
        existingPostId: null,
      });
      continue;
    }

    const entry = publicationEntry;
    const cachedRemoteMatches = entry?.remoteId
      && (!entry.remoteSlug || entry.remoteSlug === operation.wordpressSlug)
      && (!entry.contentType || entry.contentType === operation.contentType);
    const existingPostId = cachedRemoteMatches && entry?.remoteId
      ? entry.remoteId
      : getWordPressPostId({
        ids: discoveredPostIds,
        locator: { restBase: operation.restBase, slug: operation.wordpressSlug },
      }) ?? null;
    plannedOperations.push({
      ...preparedOperation,
      action: existingPostId === null ? 'create' : 'update',
      existingPostId,
    });
  }

  if (failedPosts.length > 0) {
    throw new Error(
      `WordPress publish plan is incomplete because ${failedPosts.length} post(s) failed during planning. No WordPress posts were mutated.`
    );
  }

  const publishPlan = createWordPressPublishPlan({ operations: plannedOperations });
  console.log(`\n${formatWordPressPublishPlan({ plan: publishPlan, verbose })}`);

  const apply = async ({ dryRun: applyDryRun }: { dryRun: boolean }): Promise<void> => {
    const taxonomyResolver = createWordPressTaxonomyResolver({
      request: ({ path: apiPath, method, body }) => wpFetch({
        endpoint,
        credentials,
        path: apiPath,
        method,
        body,
      }),
      createMissingTerms: !applyDryRun,
    });
    if (!applyDryRun) {
      await taxonomyResolver.preloadPayloads({
        taxonomies: publishPlan.operations
          .filter((operation) => operation.action !== 'skip' && operation.contentType === 'post' && operation.intent)
          .map((operation) => operation.intent?.taxonomies || {}),
      });
    }

    for (const operation of publishPlan.operations) {
      try {
        if (operation.action === 'skip') {
          const publicationEntry = wordpressPublicationState[operation.sourceSlug];
          if (publicationEntry && (
            publicationEntry.contentHash !== operation.sourceHash
            || publicationEntry.inputHash !== operation.inputHash
          )) {
            setWordPressPublicationStateEntry(syncState, operation.sourceSlug, {
              contentHash: operation.sourceHash,
              inputHash: operation.inputHash,
              payloadHash: operation.payloadHash,
              remoteId: publicationEntry.remoteId,
              remoteSlug: publicationEntry.remoteSlug,
              contentType: publicationEntry.contentType,
              syncedAt: publicationEntry.syncedAt,
            });
            syncStateChanged = true;
          }
          if (verbose) {
            console.log(
              `  ⏭️  Skipping "${operation.title}" (slug: ${operation.sourceSlug}) - publication inputs unchanged.`
            );
          }
          continue;
        }

        if (!operation.intent) {
          throw new Error(`Invalid WordPress publish plan: ${operation.action} "${operation.sourceSlug}" has no intent.`);
        }

        let appliedRemoteId = operation.existingPostId;
        if (operation.action === 'update') {
          const wpPostId = operation.existingPostId;
          if (wpPostId === null) {
            throw new Error(`Invalid WordPress publish plan: update "${operation.sourceSlug}" has no post ID.`);
          }
          if (applyDryRun) {
            console.log(
              `  🔄 [DRY RUN] Would UPDATE WordPress ${operation.contentType} "${operation.title}" (ID: ${wpPostId})`
            );
          } else {
            const taxonomyPayload = operation.contentType === 'post'
              ? await taxonomyResolver.resolvePayload({ taxonomies: operation.intent.taxonomies })
              : {};
            const payload = createWordPressPublishPayload({ intent: operation.intent, taxonomyPayload });
            const updateResult = WordPressMutationResponseSchema.safeParse(await wpFetch({
              endpoint,
              credentials,
              path: `/wp/v2/${operation.restBase}/${wpPostId}`,
              method: 'POST',
              body: payload,
            }));
            if (!updateResult.success || updateResult.data.id !== wpPostId) {
              throw new Error(`WordPress returned an invalid update response for "${operation.sourceSlug}".`);
            }
            console.log(`  🔄 Successfully UPDATED WordPress ${operation.contentType} (ID: ${wpPostId})`);
          }
          updatedPosts.push({
            title: operation.title,
            slug: operation.sourceSlug,
            action: 'updated',
            contentType: operation.contentType,
            id: wpPostId,
            isDryRun: applyDryRun,
          });
        } else {
          let createdId: number | null = null;
          if (applyDryRun) {
            console.log(
              `  🆕 [DRY RUN] Would CREATE new WordPress ${operation.contentType} "${operation.title}"`
            );
          } else {
            const taxonomyPayload = operation.contentType === 'post'
              ? await taxonomyResolver.resolvePayload({ taxonomies: operation.intent.taxonomies })
              : {};
            const payload = createWordPressPublishPayload({ intent: operation.intent, taxonomyPayload });
            const newPostResult = WordPressMutationResponseSchema.safeParse(await wpFetch({
              endpoint,
              credentials,
              path: `/wp/v2/${operation.restBase}`,
              method: 'POST',
              body: {
                ...payload,
                date: operation.date,
              },
            }));
            if (!newPostResult.success) {
              throw new Error(`WordPress returned an invalid create response for "${operation.sourceSlug}".`);
            }
            createdId = newPostResult.data.id;
            appliedRemoteId = createdId;
            console.log(`  🆕 Successfully CREATED new WordPress ${operation.contentType} (ID: ${createdId})`);
          }
          createdPosts.push({
            title: operation.title,
            slug: operation.sourceSlug,
            action: 'created',
            contentType: operation.contentType,
            id: createdId,
            isDryRun: applyDryRun,
          });
        }

        setWordPressPublicationStateEntry(syncState, operation.sourceSlug, {
          contentHash: operation.sourceHash,
          inputHash: operation.inputHash,
          payloadHash: operation.payloadHash,
          remoteId: appliedRemoteId ?? undefined,
          remoteSlug: operation.wordpressSlug,
          contentType: operation.contentType,
        });
        syncStateChanged = true;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`  ❌ Failed to apply publish plan for "${operation.title}":`, errMsg);
        failedPosts.push({
          title: operation.title,
          slug: operation.sourceSlug,
          error: errMsg,
        });
        if (targetSlugs && targetSlugs.length > 0) {
          throw err;
        }
      }
    }

    const skippedCount = publishPlan.operations.filter((operation) => operation.action === 'skip').length;

    if (!applyDryRun && syncStateChanged) {
      await saveSyncState({ vaultPath: site.vaultPath, syncState });
    }

    console.log(
      `\n` +
        formatWordPressPublicationSummary({
          updated: updatedPosts,
          created: createdPosts,
          failed: failedPosts,
          skippedCount,
          totalProcessed: postsToPublish.length,
          isDryRun: applyDryRun,
        })
    );
  };

  return {
    id: 'wordpress',
    label: 'WordPress publish',
    plan: publishPlan,
    apply,
  };
}

export async function publishToWordPress(args: PublishToWordPressInput): Promise<void> {
  const preparedPublication = await prepareWordPressPublication(args);
  if (!preparedPublication) return;

  assertPublicationTargetFingerprint({
    publication: preparedPublication,
    expectedFingerprint: args.expectedPlanFingerprint,
  });
  if (args.expectedPlanFingerprint) {
    console.log(`✅ WordPress publish plan fingerprint matched: ${preparedPublication.plan.fingerprint}`);
  }
  await applyPreparedPublication({ publication: preparedPublication, dryRun: args.dryRun });
}

interface WordPressPostResponse {
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

const WordPressPostResponseSchema = z.object({
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

const WordPressPostResponseArraySchema = z.array(WordPressPostResponseSchema);

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
  const originalUrl = src;

  // Check if it is an external URL
  if (tempPath.startsWith('http://') || tempPath.startsWith('https://')) {
    try {
      const urlObj = new URL(tempPath);
      tempPath = urlObj.pathname;
    } catch {
      // Keep the original path when the URL cannot be parsed.
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

  const result = render(root);
  return result
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface ImportFromWordPressInput {
  site: Site;
  registry: Registry;
  slugOrId: string;
  dryRun: boolean;
}

function findLocalImportTarget({
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

export async function importFromWordPress({
  site,
  registry,
  slugOrId,
  dryRun,
}: ImportFromWordPressInput) {
  const credentials = site.wordpress;
  if (!credentials) {
    throw new Error(`⨯ WordPress credentials are not configured for site [${site.siteId}].`);
  }

  const endpoint = credentials.endpoint || `https://${site.domain}/wp-json`;
  const taxonomyResolver = createWordPressTaxonomyResolver({
    request: ({ path: apiPath }) => wpFetch({ endpoint, credentials, path: apiPath }),
  });
  console.log(`\n📥 Preparing WordPress Import...`);
  console.log(`- Target Endpoint: ${endpoint}`);
  console.log(`- Authenticated As: ${credentials.username}`);
  console.log(`- Target Post Slug/ID: ${slugOrId}`);
  console.log(dryRun ? `- Mode: DRY RUN (No changes will be written)\n` : `- Mode: Live Import\n`);

  let wpPost: WordPressPostResponse | null = null;
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
      const postsResult = WordPressPostResponseArraySchema.safeParse(
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
      const postResult = WordPressPostResponseSchema.safeParse(
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

  const importTarget = findLocalImportTarget({ site, slugOrId, wpSlug: wpPost.slug });
  const imageFolder = importTarget.matchedExisting
    ? getContentImageFolder({ fullSlug: importTarget.canonicalSlug })
    : wpPost.slug;
  if (!importTarget.matchedExisting && site.rewrites && site.rewrites.length > 0) {
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
  validateImportedMarkdown({
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

  const targetLocalPath = importTarget.localPath;
  const canonicalSlug = importTarget.canonicalSlug;

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
    console.log(`\n  💾 Successfully imported and saved post to: ${targetLocalPath}`);

    await updateWordPressPublicationState({
      vaultPath: site.vaultPath,
      slug: canonicalSlug,
      contentHash: computeContentHash(frontmatter),
    });
    console.log(`  ✓ Updated sync state for "${canonicalSlug}" in .notopress-sync.json`);
  }
}
