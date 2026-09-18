import matter from 'gray-matter';
import { z } from 'zod';
import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises';
import { type Stats } from 'fs';
import path from 'path';
import { INDEX_JSON, ROOT_JSON } from '../../src/lib/constants';
import { PageMetadata, VaultDirectoryIndex, VaultRootIndex } from '../../src/lib/vault';
import { isGeneratedThumbnailPath, normalizeThumbnailSizes } from '../../src/lib/responsive-images';
import { exists, scanContentAssetFiles, scanPublicFiles, type FileEntry } from './files';
import { generateImageThumbnails } from './thumbnails';
import { parseContentTaxonomies } from '../../src/lib/content-metadata';
import { buildRouteTable, composeFullSlug, type RewriteRule } from '../../src/lib/rewrites';
import { findUnescapedWikilinksInTables, formatUnescapedTableWikilinkWarning } from '../../src/lib/table-wikilinks';

type Logger = Pick<typeof console, 'log' | 'warn' | 'error'>;
type MatterResult = {
  data: Record<string, unknown>;
  content: string;
};

type NoteIncludeMetadata = {
  fullSlug: string;
  title: string;
  filePath: string;
  linkable: false;
};

export type IndexGeneratorDeps = {
  exists: (path: string) => Promise<boolean>;
  mkdir: (path: string, options: { recursive: true }) => Promise<string | undefined>;
  readdir: (path: string, options: { withFileTypes: true }) => Promise<FileEntry[]>;
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
  stat: (path: string) => Promise<Pick<Stats, 'mtime'>>;
  writeFile: (path: string, content: string) => Promise<void>;
  joinPath: (...paths: string[]) => string;
  relativePath: (from: string, to: string) => string;
  parseMatter: (content: string) => MatterResult;
  normalizeThumbnailSizes: (sizes: readonly number[] | undefined) => number[];
  scanPublicFiles: ({ dir }: { dir: string }) => Promise<string[]>;
  scanContentAssetFiles: ({ dir }: { dir: string }) => Promise<string[]>;
  generateImageThumbnails: (input: {
    sourceDir: string;
    dryRun: boolean;
    thumbnailSizes: readonly number[];
    label: string;
  }) => Promise<Record<string, number[]>>;
  logger: Logger;
};

const DateInputSchema = z.union([z.string(), z.number(), z.date()]);

function parseSafeDate({
  dateInput,
  fallback,
  label,
  filePath,
  logger,
}: {
  dateInput: unknown;
  fallback: Date;
  label: string;
  filePath: string;
  logger: Logger;
}): string {
  if (!dateInput) return fallback.toISOString();

  const result = DateInputSchema.safeParse(dateInput);
  if (!result.success) {
    logger.warn(
      `⚠️  Warning: Invalid ${label} type for "${dateInput}" in ${filePath}. Falling back to file modification time.`
    );
    return fallback.toISOString();
  }

  const date = new Date(result.data);
  if (isNaN(date.getTime())) {
    logger.warn(
      `⚠️  Warning: Invalid ${label} value "${dateInput}" in ${filePath}. Falling back to file modification time.`
    );
    return fallback.toISOString();
  }

  return date.toISOString();
}

function excludeGeneratedFiles(files: readonly string[]): string[] {
  return files.filter((file) => !isGeneratedThumbnailPath(file));
}

function normalizeIncludePath(includePath: string): string {
  return includePath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

export function createIndexGenerator(deps: IndexGeneratorDeps) {
  async function scanNoteIncludes({
    vaultPath,
    noteIncludePaths,
  }: {
    vaultPath: string;
    noteIncludePaths?: readonly string[];
  }): Promise<NoteIncludeMetadata[]> {
    const noteIncludes: NoteIncludeMetadata[] = [];
    if (!noteIncludePaths || noteIncludePaths.length === 0) {
      return noteIncludes;
    }

    for (const includePath of noteIncludePaths) {
      const normalizedIncludePath = normalizeIncludePath(includePath);
      if (!normalizedIncludePath || normalizedIncludePath === 'content' || normalizedIncludePath.startsWith('content/')) {
        continue;
      }

      const includeDir = deps.joinPath(vaultPath, normalizedIncludePath);
      async function walk(currentDir: string): Promise<void> {
        if (!(await deps.exists(currentDir))) {
          return;
        }

        const entries = await deps.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = deps.joinPath(currentDir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name !== '.git' && entry.name !== 'node_modules') {
              await walk(fullPath);
            }
          } else if (entry.isFile() && entry.name.endsWith('.md')) {
            const relIncludePath = deps.relativePath(includeDir, fullPath).replace(/\\/g, '/');
            const fullSlug = relIncludePath.replace(/\.md$/i, '');
            const fileContent = await deps.readFile(fullPath, 'utf-8');
            const { data, content } = deps.parseMatter(fileContent);
            const titleMatch = content.match(/^#\s+(.+)$/m);
            const title =
              typeof data.title === 'string' && data.title.trim()
                ? data.title.trim()
                : titleMatch?.[1]?.trim() || fullSlug.split('/').pop() || fullSlug;
            noteIncludes.push({
              fullSlug,
              title,
              filePath: `${normalizedIncludePath}/${relIncludePath}`,
              linkable: false,
            });
          }
        }
      }

      await walk(includeDir);
    }

    return noteIncludes.sort((a, b) => a.fullSlug.localeCompare(b.fullSlug));
  }

  async function scanAndGenerate({
    dir,
    baseDir,
    dryRun,
    allIndices,
  }: {
    dir: string;
    baseDir: string;
    dryRun: boolean;
    allIndices: Map<string, VaultDirectoryIndex>;
  }): Promise<{ index: VaultDirectoryIndex; allDirs: string[] }> {
    const entries = await deps.readdir(dir, { withFileTypes: true });
    const pages: PageMetadata[] = [];
    const allDirs: string[] = [];

    const relDir = deps.relativePath(baseDir, dir).replace(/\\/g, '/');

    for (const entry of entries) {
      const fullPath = deps.joinPath(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== '.git' && entry.name !== 'node_modules') {
          const result = await scanAndGenerate({ dir: fullPath, baseDir, dryRun, allIndices });
          const childRelDir = deps.relativePath(baseDir, fullPath).replace(/\\/g, '/');
          allDirs.push(childRelDir, ...result.allDirs);
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const fileContent = await deps.readFile(fullPath, 'utf-8');
        const fileStats = await deps.stat(fullPath);
        const relPath = deps.relativePath(baseDir, fullPath).replace(/\\/g, '/');

        for (const issue of findUnescapedWikilinksInTables({ markdown: fileContent })) {
          deps.logger.warn(formatUnescapedTableWikilinkWarning({ filePath: relPath, issue }));
        }

        const { data, content } = deps.parseMatter(fileContent);
        const taxonomies = parseContentTaxonomies({ frontmatter: data });

        if (data.published === false) {
          continue;
        }

        const titleMatch = content.match(/^#\s+(.+)$/m);
        const title =
          typeof data.title === 'string' && data.title.trim() !== ''
            ? data.title
            : titleMatch
            ? titleMatch[1].trim()
            : entry.name;

        const slug = deps.relativePath(dir, fullPath).replace(/\.md$/, '').replace(/\\/g, '/');

        const date = parseSafeDate({
          dateInput: data.date,
          fallback: fileStats.mtime,
          label: 'date',
          filePath: relPath,
          logger: deps.logger,
        });
        const manualUpdate = data.updated || data.lastmod;
        const updatedAt = parseSafeDate({
          dateInput: manualUpdate,
          fallback: fileStats.mtime,
          label: 'updated',
          filePath: relPath,
          logger: deps.logger,
        });

        const contentWithoutCodeBlocks = content.replace(/```[\s\S]*?```/g, '');
        const firstParagraph = contentWithoutCodeBlocks
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith('#') && !line.startsWith('>'))[0];

        let excerpt = '';
        if (firstParagraph) {
          excerpt = firstParagraph.slice(0, 160);
          if (firstParagraph.length > 160) {
            excerpt += '...';
          }
        }

        pages.push({ title, slug, date, updatedAt, excerpt, ...taxonomies });
      }
    }

    pages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const indexData: VaultDirectoryIndex = {
      version: 1,
      pages,
    };

    allIndices.set(relDir, indexData);

    return { index: indexData, allDirs };
  }

  return {
    scanAndGenerate,
    async generateIndices({
      vaultPath,
      thumbnailSizes,
      noteIncludePaths,
      rewrites,
      dryRun = false,
      verbose = false,
    }: {
      vaultPath: string;
      thumbnailSizes: readonly number[];
      noteIncludePaths?: readonly string[];
      rewrites?: readonly RewriteRule[];
      dryRun?: boolean;
      verbose?: boolean;
    }): Promise<{
      rootContentIndex: VaultDirectoryIndex;
      vaultRootIndex: VaultRootIndex;
      allIndices: Map<string, VaultDirectoryIndex>;
    }> {
      const contentDir = deps.joinPath(vaultPath, 'content');
      if (!(await deps.exists(contentDir))) {
        throw new Error(`The required "content" directory is missing in the vault: ${vaultPath}`);
      }

      deps.logger.log(`\n🔍 Recursively scanning "content" directory in ${contentDir}...`);
      const allIndices = new Map<string, VaultDirectoryIndex>();
      const { index: rootContentIndex, allDirs } = await scanAndGenerate({
        dir: contentDir,
        baseDir: contentDir,
        dryRun,
        allIndices,
      });

      const fullSlugs: string[] = [];
      for (const [directory, dirIndex] of allIndices.entries()) {
        for (const page of dirIndex.pages) {
          fullSlugs.push(composeFullSlug({ directory, slug: page.slug }));
        }
      }

      const routeTable = buildRouteTable({ fullSlugs, rules: rewrites });
      for (const shadow of routeTable.shadows) {
        deps.logger.warn(
          `⚠️  Rewrite shadow: "${shadow.shadowedFullSlug}" maps to "/${shadow.publicSlug === 'page' ? '' : shadow.publicSlug}" but "${shadow.winnerFullSlug}" is served first.`
        );
      }

      for (const [directory, dirIndex] of allIndices.entries()) {
        for (const page of dirIndex.pages) {
          const fullSlug = composeFullSlug({ directory, slug: page.slug });
          page.publicSlug = routeTable.publicSlugByFullSlug[fullSlug] || page.slug;
        }
      }

      for (const [relDir, indexData] of allIndices.entries()) {
        const indexPath = relDir
          ? deps.joinPath(contentDir, relDir, INDEX_JSON)
          : deps.joinPath(contentDir, INDEX_JSON);
        if (!dryRun) {
          await deps.writeFile(indexPath, JSON.stringify(indexData, null, 2));
          if (verbose) {
            deps.logger.log(`✨ Generated index for "${relDir || 'root'}"`);
          }
        }
      }
      if (!dryRun) {
        deps.logger.log(`✨ Generated ${allIndices.size} content directory index(es).`);
      }

      const publicBaseDir = deps.joinPath(vaultPath, 'public');
      if (!dryRun) {
        await deps.mkdir(publicBaseDir, { recursive: true });
      }

      const contentResponsiveImageWidths = await deps.generateImageThumbnails({
        sourceDir: contentDir,
        dryRun,
        thumbnailSizes,
        label: 'content',
      });
      const publicResponsiveImageWidths = await deps.generateImageThumbnails({
        sourceDir: publicBaseDir,
        dryRun,
        thumbnailSizes,
        label: 'public',
      });

      const publicFiles = excludeGeneratedFiles(
        (await deps.exists(publicBaseDir)) ? await deps.scanPublicFiles({ dir: publicBaseDir }) : []
      ).sort();
      const contentAssetFiles = excludeGeneratedFiles(await deps.scanContentAssetFiles({ dir: contentDir }));
      const assetFiles = [...new Set([...publicFiles, ...contentAssetFiles])].sort();
      const noteIncludes = await scanNoteIncludes({ vaultPath, noteIncludePaths });

      const rootPath = deps.joinPath(vaultPath, ROOT_JSON);
      const vaultRootIndex: VaultRootIndex = {
        ...rootContentIndex,
        directories: allDirs,
        publicFiles,
        assetFiles,
        responsiveImageWidths: {
          ...publicResponsiveImageWidths,
          ...contentResponsiveImageWidths,
        },
        noteIncludes,
        thumbnailSizes: deps.normalizeThumbnailSizes(thumbnailSizes),
        routes: routeTable.routes,
        publicDirectories: routeTable.publicDirectories,
      };

      if (dryRun) {
        deps.logger.log(`[DRY RUN] Would generate master root index at: ${rootPath}`);
      } else {
        await deps.writeFile(rootPath, JSON.stringify(vaultRootIndex, null, 2));
        deps.logger.log(`✨ Generated master root index with ${allDirs.length} directories at: ${rootPath}`);
      }

      return { rootContentIndex, vaultRootIndex, allIndices };
    },
  };
}

const defaultIndexGenerator = createIndexGenerator({
  exists,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
  joinPath: path.join,
  relativePath: path.relative,
  parseMatter: matter,
  normalizeThumbnailSizes,
  scanPublicFiles,
  scanContentAssetFiles,
  generateImageThumbnails,
  logger: console,
});

export const scanAndGenerate = defaultIndexGenerator.scanAndGenerate;
export const generateIndices = defaultIndexGenerator.generateIndices;
