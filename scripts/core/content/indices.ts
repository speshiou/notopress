import matter from 'gray-matter';
import { z } from 'zod';
import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises';
import { type Stats } from 'fs';
import path from 'path';
import { INDEX_JSON, ROOT_JSON } from '../../../src/lib/constants';
import { PageMetadata, VaultDirectoryIndex, VaultRootIndex } from '../../../src/lib/vault';
import { isGeneratedThumbnailPath } from '../../../src/lib/responsive-images';
import { exists, scanContentAssetFiles, scanPublicFiles, type FileEntry } from '../files';
import { generateImageThumbnails } from './thumbnails';
import { parseContentTaxonomies } from '../../../src/lib/content-metadata';
import { buildRouteTable, composeFullSlug, type RewriteRule } from '../../../src/lib/rewrites';
import { findUnescapedWikilinksInTables, formatUnescapedTableWikilinkWarning } from '../../../src/lib/table-wikilinks';
import { passthroughStageTimer, type StageTimer } from '../stage-timing';
import { createBuildArtifact, type CollectBuildArtifact, type BuildArtifact } from './build-artifact';
import { isGeneratedArtifactDirectory, isGeneratedSitemapPath } from './generated-paths';
import { compareStrings } from '../order';

type Logger = Pick<typeof console, 'log' | 'warn' | 'error'>;
type MatterResult = {
  data: Record<string, unknown>;
  content: string;
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
  scanPublicFiles: ({ dir }: { dir: string }) => Promise<string[]>;
  scanContentAssetFiles: ({ dir }: { dir: string }) => Promise<string[]>;
  generateImageThumbnails: (input: {
    sourceDir: string;
    dryRun: boolean;
    thumbnailSizes: readonly number[];
    label: string;
    collectArtifact?: CollectBuildArtifact;
    collectSourceArtifact?: CollectBuildArtifact;
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

export function createIndexGenerator(deps: IndexGeneratorDeps) {
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
    const entries = [...await deps.readdir(dir, { withFileTypes: true })].sort((left, right) => compareStrings({ left: left.name, right: right.name }));
    const pages: PageMetadata[] = [];
    const allDirs: string[] = [];

    const relDir = deps.relativePath(baseDir, dir).replace(/\\/g, '/');

    for (const entry of entries) {
      const fullPath = deps.joinPath(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== '.git' && entry.name !== 'node_modules' && !isGeneratedArtifactDirectory(entry.name)) {
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

    pages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || compareStrings({ left: a.slug, right: b.slug }));

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
      rewrites,
      dryRun = false,
      verbose = false,
      stageTimer = passthroughStageTimer,
      collectArtifact,
      collectSourceArtifact,
    }: {
      vaultPath: string;
      thumbnailSizes: readonly number[];
      rewrites?: readonly RewriteRule[];
      dryRun?: boolean;
      verbose?: boolean;
      stageTimer?: StageTimer;
      collectArtifact?: CollectBuildArtifact;
      collectSourceArtifact?: CollectBuildArtifact;
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
      const { index: rootContentIndex, allDirs } = await stageTimer.measure({
        stage: 'build.content-scan',
        run: () => scanAndGenerate({
          dir: contentDir,
          baseDir: contentDir,
          dryRun,
          allIndices,
        }),
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
        collectArtifact?.(createBuildArtifact({
          path: relDir ? `content/${relDir}/${INDEX_JSON}` : `content/${INDEX_JSON}`,
          content: JSON.stringify(indexData, null, 2),
        }));
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

      const contentResponsiveImageWidths = await stageTimer.measure({
        stage: 'build.thumbnails.content',
        run: () => deps.generateImageThumbnails({
          sourceDir: contentDir,
          dryRun,
          thumbnailSizes,
          label: 'content',
          ...(collectArtifact ? { collectArtifact: (artifact) => collectArtifact({ ...artifact, path: `content/${artifact.path}` }) } : {}),
          ...(collectSourceArtifact ? { collectSourceArtifact: (artifact: BuildArtifact) => collectSourceArtifact({ ...artifact, path: `content/${artifact.path}` }) } : {}),
        }),
      });
      const publicResponsiveImageWidths = await stageTimer.measure({
        stage: 'build.thumbnails.public',
        run: () => deps.generateImageThumbnails({
          sourceDir: publicBaseDir,
          dryRun,
          thumbnailSizes,
          label: 'public',
          ...(collectArtifact ? { collectArtifact: (artifact) => collectArtifact({ ...artifact, path: `public/${artifact.path}` }) } : {}),
          ...(collectSourceArtifact ? { collectSourceArtifact: (artifact: BuildArtifact) => collectSourceArtifact({ ...artifact, path: `public/${artifact.path}` }) } : {}),
        }),
      });

      const { publicFiles, contentAssetFiles } = await stageTimer.measure({
        stage: 'build.asset-scan',
        run: async () => ({
          publicFiles: excludeGeneratedFiles(
            (await deps.exists(publicBaseDir)) ? await deps.scanPublicFiles({ dir: publicBaseDir }) : []
          ).filter((file) => !isGeneratedSitemapPath(file)).sort(),
          contentAssetFiles: excludeGeneratedFiles(await deps.scanContentAssetFiles({ dir: contentDir })),
        }),
      });
      const assetFiles = [...new Set([...publicFiles, ...contentAssetFiles])].sort();
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
        routes: routeTable.routes,
        publicDirectories: routeTable.publicDirectories,
      };

      collectArtifact?.(createBuildArtifact({ path: ROOT_JSON, content: JSON.stringify(vaultRootIndex, null, 2) }));

      if (dryRun) {
        deps.logger.log(`${collectArtifact ? '[PLAN]' : '[DRY RUN]'} Would generate master root index at: ${rootPath}`);
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
  scanPublicFiles,
  scanContentAssetFiles,
  generateImageThumbnails,
  logger: console,
});

export const scanAndGenerate = defaultIndexGenerator.scanAndGenerate;
export const generateIndices = defaultIndexGenerator.generateIndices;
