import type { ContentTaxonomies } from '../../../src/domain/content-metadata';
import {
  isExternalOrInlineAsset,
  resolveMarkdownImagePaths,
  safelyDecodeUriComponent,
} from '../../../src/lib/local-images';
import type { NoteReference } from '../../../src/lib/note-links';
import { computeContentHash } from '../../core/state/sync-state';
import type { WordPressPublishContentType } from './publish-payload';

const WORDPRESS_RENDERER_REVISION = 1;

function collectLocalImageInputs({
  markdown,
  assetFiles,
  responsiveImageWidths,
}: {
  markdown: string;
  assetFiles: readonly string[];
  responsiveImageWidths?: Readonly<Record<string, readonly number[]>>;
}) {
  const resolvedMarkdown = resolveMarkdownImagePaths({ markdown, availableFiles: assetFiles });
  const inputs: { path: string; widths: readonly number[] | null }[] = [];
  const imagePattern = /!\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+[^)]*)?\)/g;
  let match: RegExpExecArray | null;

  while ((match = imagePattern.exec(resolvedMarkdown)) !== null) {
    const rawPath = match[1].startsWith('<') ? match[1].slice(1, -1) : match[1];
    if (isExternalOrInlineAsset({ src: rawPath })) continue;
    const imagePath = safelyDecodeUriComponent({ value: rawPath.replace(/^\//, '') });
    inputs.push({
      path: imagePath,
      widths: responsiveImageWidths?.[imagePath] || null,
    });
  }

  return inputs.sort((left, right) => left.path.localeCompare(right.path));
}

export function computeWordPressPublicationInputHash({
  sourceHash,
  markdown,
  title,
  wordpressSlug,
  contentType,
  taxonomies,
  noteReferences,
  siteId,
  imageHost,
  thumbnailSizes,
  assetFiles,
  responsiveImageWidths,
}: {
  sourceHash: string;
  markdown: string;
  title: string;
  wordpressSlug: string;
  contentType: WordPressPublishContentType;
  taxonomies: ContentTaxonomies;
  noteReferences: readonly NoteReference[];
  siteId: string;
  imageHost: string;
  thumbnailSizes: readonly number[];
  assetFiles: readonly string[];
  responsiveImageWidths?: Readonly<Record<string, readonly number[]>>;
}): string {
  const embeddedMarkdown = noteReferences
    .map((reference) => reference.content || '')
    .filter(Boolean)
    .join('\n');

  return computeContentHash(JSON.stringify({
    rendererRevision: WORDPRESS_RENDERER_REVISION,
    sourceHash,
    title,
    wordpressSlug,
    contentType,
    taxonomies,
    references: noteReferences.map((reference) => ({
      fullSlug: reference.fullSlug,
      title: reference.title,
      href: reference.href,
      content: reference.content || null,
    })),
    rendering: {
      siteId,
      imageHost,
      thumbnailSizes,
      images: collectLocalImageInputs({
        markdown: `${markdown}\n${embeddedMarkdown}`,
        assetFiles,
        responsiveImageWidths,
      }),
    },
  }));
}
