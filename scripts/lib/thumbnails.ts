import sharp from 'sharp';
import { mkdir, readdir } from 'fs/promises';
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
      for (const imageFile of imageFiles) {
        const inputPath = deps.joinPath(sourceDir, imageFile);

        for (const width of sizes) {
          const thumbnailRelPath = deps.getThumbnailPath({ imagePath: imageFile, width });
          const outputPath = deps.joinPath(sourceDir, thumbnailRelPath);

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

      deps.logger.log(`✨ Generated ${generatedCount} ${label} responsive image thumbnails.`);
    },
  };
}

const defaultThumbnailGenerator = createThumbnailGenerator({
  exists,
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
