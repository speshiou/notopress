import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import { RENDERED_DIR } from '../../src/lib/constants';
import { renderMarkdownContent } from '../../src/lib/markdown';
import { VaultDirectoryIndex, VaultRootIndex } from '../../src/lib/vault';
import { type NoteReferenceInput } from '../../src/lib/note-links';
import { composeFullSlug, isRouteWinner, toPublicSlug } from '../../src/lib/rewrites';
import { collectNoteReferencesForLocalMarkdown, collectPrivateNoteIncludes } from './note-includes';

type Logger = Pick<typeof console, 'log'>;

type RenderedContentChange = 'create' | 'update' | null;

function stripFirstMarkdownHeading(markdown: string): string {
  return markdown.replace(/^#\s+.+$/m, '').trim();
}

function buildPublicNoteReferences({
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

export function getRenderedContentPath({ fullSlug }: { fullSlug: string }): string {
  return `${RENDERED_DIR}/content/${fullSlug}.html`;
}

async function getRenderedContentChange({
  renderedPath,
  renderedHtml,
}: {
  renderedPath: string;
  renderedHtml: string;
}): Promise<RenderedContentChange> {
  try {
    const existingHtml = await readFile(renderedPath, 'utf-8');
    return existingHtml === renderedHtml ? null : 'update';
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return 'create';
    }
    throw error;
  }
}

export async function generateRenderedContent({
  vaultPath,
  siteId,
  imageHost,
  allIndices,
  rootIndex,
  thumbnailSizes,
  noteIncludePaths,
  dryRun,
  logger = console,
}: {
  vaultPath: string;
  siteId: string;
  imageHost?: string;
  allIndices: Map<string, VaultDirectoryIndex>;
  rootIndex: VaultRootIndex;
  thumbnailSizes: readonly number[];
  noteIncludePaths?: readonly string[];
  dryRun: boolean;
  logger?: Logger;
}): Promise<void> {
  const assetFiles = rootIndex.assetFiles || rootIndex.publicFiles;
  const publicNoteReferences = buildPublicNoteReferences({ allIndices, routes: rootIndex.routes });
  const privateNoteReferences = await collectPrivateNoteIncludes({ vaultPath, includePaths: noteIncludePaths });
  let renderedCount = 0;
  let changedCount = 0;

  for (const [dirKey, dirIndex] of allIndices.entries()) {
    for (const page of dirIndex.pages) {
      const fullSlug = dirKey ? `${dirKey}/${page.slug}` : page.slug;
      const markdownPath = path.join(vaultPath, 'content', `${fullSlug}.md`);
      const renderedPath = path.join(vaultPath, getRenderedContentPath({ fullSlug }));
      const markdownFile = await readFile(markdownPath, 'utf-8');
      const { content } = matter(markdownFile);
      const markdown = stripFirstMarkdownHeading(content);
      const noteReferences = await collectNoteReferencesForLocalMarkdown({
        publicNoteReferences,
        privateNoteReferences,
        markdown,
        readPublicNote: ({ fullSlug: noteSlug }) => readFile(path.join(vaultPath, 'content', `${noteSlug}.md`), 'utf-8'),
      });
      const html = await renderMarkdownContent({
        markdown,
        thumbnailSizes,
        assetFiles,
        responsiveImageWidths: rootIndex.responsiveImageWidths,
        noteReferences,
        assetUrlConfig: {
          imageHost,
          siteId,
          s3SubDir: 'content',
          mode: imageHost ? 'absolute' : 'app-relative',
        },
      });

      if (dryRun) {
        const change = await getRenderedContentChange({ renderedPath, renderedHtml: html });
        if (change) {
          logger.log(`[DRY RUN] Would ${change} rendered HTML: ${getRenderedContentPath({ fullSlug })}`);
          changedCount += 1;
        }
      } else {
        await mkdir(path.dirname(renderedPath), { recursive: true });
        await writeFile(renderedPath, html);
      }
      renderedCount += 1;
    }
  }

  if (!dryRun) {
    logger.log(`✨ Generated ${renderedCount} rendered HTML file(s) in ${RENDERED_DIR}/content`);
  } else {
    logger.log(`[DRY RUN] ${changedCount} of ${renderedCount} rendered HTML file(s) would change`);
  }
}
