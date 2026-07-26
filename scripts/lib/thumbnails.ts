import sharp from 'sharp';
import { mkdir, readdir, stat } from 'fs/promises';
import path from 'path';
import { THUMBNAILS_DIR } from '../../src/lib/constants';
import {
  getThumbnailPath,
  isGeneratedThumbnailPath,
  isSupportedResponsiveImage,
  normalizeThumbnailSizes,
} from '../../src/lib/responsive-images';
import { exists } from './files';
import { type FileEntry } from './files';

type Logger = Pick<typeof console, 'log'>;

export type ThumbnailGeneratorDeps = {
  exists: (path: string) => Promise<boolean>;
  getFileStat: (path: string) => Promise<{ mtimeMs: number; size: number } | null>;
  readdir: (path: string, options: { withFileTypes: true }) => Promise<FileEntry[]>;
  mkdir: (path: string, options: { recursive: true }) => Promise<string | undefined>;
  joinPath: (...paths: string[]) => string;
  relativePath: (from: string, to: string) => string;
  dirnamePath: (path: string) => string;
  generatedThumbnailDir: string;
  normalizeThumbnailSizes: (sizes: readonly number[] | undefined) => number[];
  isSupportedResponsiveImage: (filePath: string) => boolean;
  isGeneratedThumbnailPath: (filePath: string) => boolean;
  getThumbnailPath: ({ imagePath, width }: { imagePath: string; width: number }) => string;
  processImage: ({ inputPath, outputPath, width }: { inputPath: string; outputPath: string; width: number }) => Promise<void>;
  logger: Logger;
};

export function createThumbnailGenerator(deps: ThumbnailGeneratorDeps) {
  async function collectSourceImages({ dir, baseDir = dir }: { dir: string; baseDir?: string }): Promise<string[]> {
    const files: string[] = [];

    async function walk(currentDir: string) {
      if (!(await deps.exists(currentDir))) return;
      const entries = await deps.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = deps.joinPath(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (entry.name !== '.git' && entry.name !== 'node_modules' && entry.name !== deps.generatedThumbnailDir) {
            await walk(fullPath);
          }
        } else if (entry.isFile()) {
          const relPath = deps.relativePath(baseDir, fullPath).replace(/\\/g, '/');
          if (deps.isSupportedResponsiveImage(relPath) && !deps.isGeneratedThumbnailPath(relPath)) {
            files.push(relPath);
          }
        }
      }
    }

    await walk(dir);
    return files;
  }

  return {
    collectSourceImages,
    async generateImageThumbnails({
      sourceDir,
      dryRun,
      thumbnailSizes,
      label,
    }: {
      sourceDir: string;
      dryRun: boolean;
      thumbnailSizes: readonly number[];
      label: string;
    }): Promise<void> {
      if (!(await deps.exists(sourceDir))) return;

      const sizes = deps.normalizeThumbnailSizes(thumbnailSizes);
      const imageFiles = await collectSourceImages({ dir: sourceDir });

      if (imageFiles.length === 0) {
        deps.logger.log(`ℹ️  No responsive image thumbnails needed for ${label}.`);
        return;
      }

      let generatedCount = 0;
      let skippedCount = 0;

      for (const imageFile of imageFiles) {
        const inputPath = deps.joinPath(sourceDir, imageFile);
        const sourceStat = await deps.getFileStat(inputPath);

        for (const width of sizes) {
          const thumbnailRelPath = deps.getThumbnailPath({ imagePath: imageFile, width });
          const outputPath = deps.joinPath(sourceDir, thumbnailRelPath);
          const targetStat = await deps.getFileStat(outputPath);

          // Skip image re-encoding if the thumbnail exists, is non-empty, and its modification timestamp
          // is newer than or equal to the source image's timestamp. This avoids CPU re-encoding work
          // and preserves local file modification times for S3 sync (#38).
          const isUpToDate =
            sourceStat !== null &&
            targetStat !== null &&
            targetStat.size > 0 &&
            targetStat.mtimeMs >= sourceStat.mtimeMs;

          if (isUpToDate) {
            skippedCount += 1;
            continue;
          }

          if (dryRun) {
            deps.logger.log(`[DRY RUN] Would generate ${label} thumbnail: ${thumbnailRelPath}`);
            generatedCount += 1;
            continue;
          }

          await deps.mkdir(deps.dirnamePath(outputPath), { recursive: true });
          await deps.processImage({ inputPath, outputPath, width });
          generatedCount += 1;
        }
      }

      if (skippedCount > 0 && generatedCount === 0) {
        deps.logger.log(`✨ All ${skippedCount} ${label} responsive image thumbnails are up to date.`);
      } else if (skippedCount > 0) {
        deps.logger.log(
          `✨ Generated ${generatedCount} ${label} responsive image thumbnails (${skippedCount} up to date, skipped).`
        );
      } else {
        deps.logger.log(`✨ Generated ${generatedCount} ${label} responsive image thumbnails.`);
      }
    },
  };
}

const defaultThumbnailGenerator = createThumbnailGenerator({
  exists,
  getFileStat: async (filePath: string) => {
    try {
      const fileStat = await stat(filePath);
      return { mtimeMs: fileStat.mtimeMs, size: fileStat.size };
    } catch {
      return null;
    }
  },
  readdir,
  mkdir,
  joinPath: path.join,
  relativePath: path.relative,
  dirnamePath: path.dirname,
  generatedThumbnailDir: THUMBNAILS_DIR,
  normalizeThumbnailSizes,
  isSupportedResponsiveImage,
  isGeneratedThumbnailPath,
  getThumbnailPath,
  processImage: async ({ inputPath, outputPath, width }) => {
    await sharp(inputPath)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(outputPath);
  },
  logger: console,
});

export const collectSourceImages = defaultThumbnailGenerator.collectSourceImages;
export const generateImageThumbnails = defaultThumbnailGenerator.generateImageThumbnails;
