import { readdir, readFile } from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import {
  createNoteReferenceResolver,
  extractWikilinkTargets,
  type NoteReference,
  type NoteReferenceInput,
} from '../../src/lib/note-links';

type NoteIncludeSource = {
  fullSlug: string;
  title: string;
  filePath: string;
  linkable: false;
};

type Logger = Pick<typeof console, 'warn'>;

function stripFirstMarkdownHeading(markdown: string): string {
  return markdown.replace(/^#\s+.+$/m, '').trim();
}

function getTitleFromMarkdown({ markdown, fallback }: { markdown: string; fallback: string }): string {
  const { data, content } = matter(markdown);
  if (typeof data.title === 'string' && data.title.trim()) {
    return data.title.trim();
  }
  const titleMatch = content.match(/^#\s+(.+)$/m);
  return titleMatch?.[1]?.trim() || fallback;
}

function normalizeIncludePath(includePath: string): string {
  return includePath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

async function scanMarkdownFiles({ dir, baseDir }: { dir: string; baseDir: string }): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '.git' && entry.name !== 'node_modules') {
          await walk(fullPath);
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(path.relative(baseDir, fullPath).replace(/\\/g, '/'));
      }
    }
  }

  await walk(dir);
  return files;
}

export async function collectPrivateNoteIncludes({
  vaultPath,
  includePaths,
  logger = console,
}: {
  vaultPath: string;
  includePaths?: readonly string[];
  logger?: Logger;
}): Promise<NoteReferenceInput[]> {
  const includeSources: NoteIncludeSource[] = [];
  if (!includePaths || includePaths.length === 0) {
    return includeSources;
  }

  for (const includePath of includePaths) {
    const normalizedPath = normalizeIncludePath(includePath);
    if (!normalizedPath || normalizedPath === 'content' || normalizedPath.startsWith('content/')) {
      continue;
    }

    const fullIncludePath = path.join(vaultPath, normalizedPath);
    try {
      const markdownFiles = await scanMarkdownFiles({ dir: fullIncludePath, baseDir: fullIncludePath });
      for (const markdownFile of markdownFiles) {
        const filePath = path.join(fullIncludePath, markdownFile);
        const fileContent = await readFile(filePath, 'utf-8');
        const slug = markdownFile.replace(/\.md$/i, '');
        includeSources.push({
          fullSlug: slug,
          title: getTitleFromMarkdown({
            markdown: fileContent,
            fallback: path.basename(slug),
          }),
          linkable: false,
          filePath,
        });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`  ⚠️  Failed to scan note include path "${normalizedPath}": ${message}`);
    }
  }

  return includeSources;
}

function buildPrivateSourcesBySlug({
  privateNoteReferences,
}: {
  privateNoteReferences: readonly NoteReferenceInput[];
}): Map<string, NoteIncludeSource> {
  const sources = new Map<string, NoteIncludeSource>();
  for (const note of privateNoteReferences) {
    if ('filePath' in note && typeof note.filePath === 'string') {
      const source: NoteIncludeSource = {
        fullSlug: note.fullSlug,
        title: note.title,
        filePath: note.filePath,
        linkable: false,
      };
      sources.set(note.fullSlug, source);
    }
  }
  return sources;
}

export async function collectNoteReferencesForLocalMarkdown({
  publicNoteReferences,
  privateNoteReferences = [],
  markdown,
  readPublicNote,
  logger = console,
}: {
  publicNoteReferences: readonly NoteReferenceInput[];
  privateNoteReferences?: readonly NoteReferenceInput[];
  markdown: string;
  readPublicNote: ({ fullSlug }: { fullSlug: string }) => Promise<string>;
  logger?: Logger;
}): Promise<NoteReference[]> {
  const wikilinkTargets = extractWikilinkTargets(markdown);
  if (wikilinkTargets.links.length === 0 && wikilinkTargets.embeds.length === 0) {
    return [];
  }

  const publicResolver = createNoteReferenceResolver({ notes: publicNoteReferences });
  const embedResolver = createNoteReferenceResolver({ notes: [...publicNoteReferences, ...privateNoteReferences] });
  const privateSourcesBySlug = buildPrivateSourcesBySlug({ privateNoteReferences });
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
    if (!reference || fetchedEmbedSlugs.has(reference.fullSlug)) {
      continue;
    }
    fetchedEmbedSlugs.add(reference.fullSlug);

    try {
      const privateSource = privateSourcesBySlug.get(reference.fullSlug);
      const embeddedMarkdown = privateSource ? await readFile(privateSource.filePath, 'utf-8') : await readPublicNote(reference);
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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`  ⚠️  Failed to read embedded note "${reference.fullSlug}": ${message}`);
    }
  }

  return [...referencesByFullSlug.values()];
}
