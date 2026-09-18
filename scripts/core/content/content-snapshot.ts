import { readFile } from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import { z } from 'zod';
import type { ContentTaxonomies } from '../../../src/domain/content-metadata';
import type { VaultDirectoryIndex } from '../../../src/lib/vault';
import { parseContentTaxonomies } from '../../../src/lib/content-metadata';
import { composeFullSlug } from '../../../src/lib/rewrites';
import { computeContentHash } from '../state/sync-state';

const FrontmatterSchema = z.record(z.string(), z.unknown());

export type ContentSnapshotDocument = {
  directory: string;
  sourceSlug: string;
  leafSlug: string;
  publicSlug: string;
  localPath: string;
  title: string;
  date: string;
  taxonomies: ContentTaxonomies;
  frontmatter: Record<string, unknown>;
  markdown: string;
  rawSource: string;
  sourceHash: string;
};

export type ContentSnapshot = {
  documents: readonly ContentSnapshotDocument[];
};

type ContentSnapshotDeps = {
  readFile: (filePath: string, encoding: BufferEncoding) => Promise<string>;
  joinPath: (...paths: string[]) => string;
  parseMatter: (source: string) => { data: unknown; content: string };
  computeHash: (source: string) => string;
};

export function stripLeadingMarkdownTitle({ markdown }: { markdown: string }): string {
  const lines = markdown.split('\n');
  let inCodeBlock = false;

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
    }
    if (!inCodeBlock && trimmed.startsWith('# ')) {
      const hasContentBefore = lines.slice(0, index).some((line) => line.trim() !== '');
      if (!hasContentBefore) {
        lines.splice(index, 1);
      }
      break;
    }
  }

  return lines.join('\n').trim();
}

export function createContentSnapshotBuilder(deps: ContentSnapshotDeps) {
  return async function buildContentSnapshot({
    vaultPath,
    allIndices,
  }: {
    vaultPath: string;
    allIndices: Map<string, VaultDirectoryIndex>;
  }): Promise<ContentSnapshot> {
    const documents: ContentSnapshotDocument[] = [];

    for (const [directory, directoryIndex] of allIndices.entries()) {
      for (const page of directoryIndex.pages) {
        const sourceSlug = composeFullSlug({ directory, slug: page.slug });
        const localPath = deps.joinPath(vaultPath, 'content', directory, `${page.slug}.md`);
        const rawSource = await deps.readFile(localPath, 'utf-8');
        const parsed = deps.parseMatter(rawSource);
        const frontmatterResult = FrontmatterSchema.safeParse(parsed.data);
        if (!frontmatterResult.success) {
          throw new Error(`Invalid frontmatter object in ${sourceSlug}.`);
        }

        documents.push({
          directory,
          sourceSlug,
          leafSlug: page.slug,
          publicSlug: page.publicSlug || sourceSlug,
          localPath,
          title: page.title,
          date: page.date,
          taxonomies: parseContentTaxonomies({ frontmatter: frontmatterResult.data }),
          frontmatter: frontmatterResult.data,
          markdown: stripLeadingMarkdownTitle({ markdown: parsed.content }),
          rawSource,
          sourceHash: deps.computeHash(rawSource),
        });
      }
    }

    return { documents };
  };
}

export const buildContentSnapshot = createContentSnapshotBuilder({
  readFile,
  joinPath: path.join,
  parseMatter: matter,
  computeHash: computeContentHash,
});

export function findSnapshotDocument({
  snapshot,
  sourceSlug,
}: {
  snapshot: ContentSnapshot;
  sourceSlug: string;
}): ContentSnapshotDocument | undefined {
  return snapshot.documents.find((document) => document.sourceSlug === sourceSlug);
}
