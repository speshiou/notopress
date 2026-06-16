import matter from 'gray-matter';
import { z } from 'zod';
import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises';
import { type Stats } from 'fs';
import path from 'path';
import { INDEX_JSON, ROOT_JSON } from '../../src/lib/constants';
import { PageMetadata, VaultDirectoryIndex, VaultRootIndex } from '../../src/lib/vault';
import { normalizeThumbnailSizes } from '../../src/lib/responsive-images';
import { exists, scanContentAssetFiles, scanPublicFiles, type FileEntry } from './files';
import { generateImageThumbnails } from './thumbnails';

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
  normalizeThumbnailSizes: (sizes: readonly number[] | undefined) => number[];
  scanPublicFiles: ({ dir }: { dir: string }) => Promise<string[]>;
  scanContentAssetFiles: ({ dir }: { dir: string }) => Promise<string[]>;
  generateImageThumbnails: (input: {
    sourceDir: string;
    dryRun: boolean;
    thumbnailSizes: readonly number[];
    label: string;
  }) => Promise<void>;
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
    const entries = await deps.readdir(dir, { withFileTypes: true });
    const pages: PageMetadata[] = [];
    let allDirs: string[] = [];

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

        const { data, content } = deps.parseMatter(fileContent);

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

        const relPath = deps.relativePath(baseDir, fullPath).replace(/\\/g, '/');
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

        const firstParagraph = content
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

        pages.push({ title, slug, date, updatedAt, excerpt });
      }
    }

    pages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const indexData: VaultDirectoryIndex = {
      version: 1,
      pages,
    };

    const indexPath = deps.joinPath(dir, INDEX_JSON);
    const relDirName = relDir || 'root';

    if (!dryRun) {
      await deps.writeFile(indexPath, JSON.stringify(indexData, null, 2));
      deps.logger.log(`✨ Generated index for "${relDirName}"`);
    }

    allIndices.set(relDir, indexData);

    return { index: indexData, allDirs };
  }

  return {
    scanAndGenerate,
    async generateIndices({
      vaultPath,
      thumbnailSizes,
      dryRun = false,
    }: {
      vaultPath: string;
      thumbnailSizes: readonly number[];
      dryRun?: boolean;
    }): Promise<{ rootContentIndex: VaultDirectoryIndex; allIndices: Map<string, VaultDirectoryIndex> }> {
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

      const publicBaseDir = deps.joinPath(vaultPath, 'public');
      if (!dryRun) {
        await deps.mkdir(publicBaseDir, { recursive: true });
      }

      await deps.generateImageThumbnails({
        sourceDir: contentDir,
        dryRun,
        thumbnailSizes,
        label: 'content',
      });
      await deps.generateImageThumbnails({
        sourceDir: publicBaseDir,
        dryRun,
        thumbnailSizes,
        label: 'public',
      });

      const publicFiles = (await deps.exists(publicBaseDir)) ? await deps.scanPublicFiles({ dir: publicBaseDir }) : [];
      const contentAssetFiles = await deps.scanContentAssetFiles({ dir: contentDir });
      const assetFiles = [...new Set([...publicFiles, ...contentAssetFiles])].sort();

      const rootPath = deps.joinPath(vaultPath, ROOT_JSON);
      const vaultRootIndex: VaultRootIndex = {
        ...rootContentIndex,
        directories: allDirs,
        publicFiles: assetFiles,
        thumbnailSizes: deps.normalizeThumbnailSizes(thumbnailSizes),
      };

      if (dryRun) {
        deps.logger.log(`[DRY RUN] Would generate master root index at: ${rootPath}`);
      } else {
        await deps.writeFile(rootPath, JSON.stringify(vaultRootIndex, null, 2));
        deps.logger.log(`✨ Generated master root index with ${allDirs.length} directories at: ${rootPath}`);
      }

      return { rootContentIndex, allIndices };
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
