import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { RENDERED_DIR } from '../../src/lib/constants';
import { renderMarkdownContent } from '../../src/lib/markdown';
import { VaultDirectoryIndex, VaultRootIndex } from '../../src/lib/vault';
import { type NoteReferenceInput } from '../../src/lib/note-links';
import { isRouteWinner } from '../../src/lib/rewrites';
import { collectNoteReferencesForLocalMarkdown, collectPrivateNoteIncludes } from './note-includes';
import {
  buildContentSnapshot,
  findSnapshotDocument,
  type ContentSnapshot,
} from './content-snapshot';

type Logger = Pick<typeof console, 'log'>;

type RenderedContentChange = 'create' | 'update' | null;

function buildPublicNoteReferences({
  contentSnapshot,
  routes,
}: {
  contentSnapshot: ContentSnapshot;
  routes?: Record<string, string>;
}): NoteReferenceInput[] {
  return contentSnapshot.documents.map((document) => ({
    fullSlug: document.sourceSlug,
    title: document.title,
    publicSlug: document.publicSlug,
    shadowed: routes
      ? !isRouteWinner({
        routes,
        publicSlug: document.publicSlug,
        fullSlug: document.sourceSlug,
      })
      : false,
  }));
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
  contentSnapshot,
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
  contentSnapshot?: ContentSnapshot;
  rootIndex: VaultRootIndex;
  thumbnailSizes: readonly number[];
  noteIncludePaths?: readonly string[];
  dryRun: boolean;
  logger?: Logger;
}): Promise<void> {
  const snapshot = contentSnapshot || await buildContentSnapshot({ vaultPath, allIndices });
  const assetFiles = rootIndex.assetFiles || rootIndex.publicFiles;
  const publicNoteReferences = buildPublicNoteReferences({ contentSnapshot: snapshot, routes: rootIndex.routes });
  const privateNoteReferences = await collectPrivateNoteIncludes({ vaultPath, includePaths: noteIncludePaths });
  let renderedCount = 0;
  let changedCount = 0;

  for (const document of snapshot.documents) {
    const renderedPath = path.join(vaultPath, getRenderedContentPath({ fullSlug: document.sourceSlug }));
    const noteReferences = await collectNoteReferencesForLocalMarkdown({
      publicNoteReferences,
      privateNoteReferences,
      markdown: document.markdown,
      readPublicNote: async ({ fullSlug: noteSlug }) => {
        const embeddedDocument = findSnapshotDocument({ snapshot, sourceSlug: noteSlug });
        if (!embeddedDocument) {
          throw new Error(`Could not find embedded public note "${noteSlug}" in the content snapshot.`);
        }
        return embeddedDocument.rawSource;
      },
    });
    const html = await renderMarkdownContent({
      markdown: document.markdown,
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
        logger.log(`[DRY RUN] Would ${change} rendered HTML: ${getRenderedContentPath({ fullSlug: document.sourceSlug })}`);
        changedCount += 1;
      }
    } else {
      await mkdir(path.dirname(renderedPath), { recursive: true });
      await writeFile(renderedPath, html);
    }
    renderedCount += 1;
  }

  if (!dryRun) {
    logger.log(`✨ Generated ${renderedCount} rendered HTML file(s) in ${RENDERED_DIR}/content`);
  } else {
    logger.log(`[DRY RUN] ${changedCount} of ${renderedCount} rendered HTML file(s) would change`);
  }
}
