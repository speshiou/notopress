import sharp from 'sharp';
import { mkdir, readdir, readFile, stat } from 'fs/promises';
import path from 'path';
import { THUMBNAILS_DIR } from '../../../src/lib/constants';
import {
  getThumbnailPath,
  isGeneratedThumbnailPath,
  isSupportedResponsiveImage,
  normalizeThumbnailSizes,
} from '../../../src/lib/responsive-images';
import { exists, type FileEntry } from '../files';
import { createBuildArtifact, type CollectBuildArtifact } from './build-artifact';

type Logger = Pick<typeof console, 'log'>;

export type ThumbnailGeneratorDeps = {
  exists: (path: string) => Promise<boolean>;
  getFileStat: (path: string) => Promise<{ mtimeMs: number; size: number } | null>;
  getImageWidth: (path: string) => Promise<number | null>;
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
  renderImage?: (input: { inputPath: string; width: number }) => Promise<Uint8Array>;
  readImage?: (path: string) => Promise<Uint8Array>;
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
      collectArtifact,
      collectSourceArtifact,
    }: {
      sourceDir: string;
      dryRun: boolean;
      thumbnailSizes: readonly number[];
      label: string;
      collectArtifact?: CollectBuildArtifact;
      collectSourceArtifact?: CollectBuildArtifact;
    }): Promise<Record<string, number[]>> {
      if (!(await deps.exists(sourceDir))) return {};

      const sizes = deps.normalizeThumbnailSizes(thumbnailSizes);
      const imageFiles = await collectSourceImages({ dir: sourceDir });
      const generatedWidths: Record<string, number[]> = {};

      if (imageFiles.length === 0) {
        deps.logger.log(`ℹ️  No responsive image thumbnails needed for ${label}.`);
        return generatedWidths;
      }

      let generatedCount = 0;
      let skippedCount = 0;

      for (const imageFile of imageFiles) {
        const inputPath = deps.joinPath(sourceDir, imageFile);
        if (collectSourceArtifact) {
          const readImage = deps.readImage;
          if (!readImage) throw new Error('Source validation requires an injected image reader.');
          collectSourceArtifact(createBuildArtifact({ path: imageFile, content: await readImage(inputPath), read: () => readImage(inputPath) }));
        }
        const sourceStat = await deps.getFileStat(inputPath);
        const sourceWidth = await deps.getImageWidth(inputPath);
        const widths = sourceWidth === null
          ? sizes
          : [
              ...sizes.filter((width) => width <= sourceWidth),
              ...(sourceWidth < sizes[sizes.length - 1] && !sizes.includes(sourceWidth) ? [sourceWidth] : []),
            ].sort((left, right) => left - right);
        generatedWidths[imageFile] = widths;

        for (const width of widths) {
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
            if (collectArtifact) {
              const readImage = deps.readImage;
              if (!readImage) throw new Error('Artifact planning requires an injected thumbnail reader.');
              collectArtifact(createBuildArtifact({ path: thumbnailRelPath, content: await readImage(outputPath), read: () => readImage(outputPath) }));
            }
            skippedCount += 1;
            continue;
          }

          if (collectArtifact) {
            const renderImage = deps.renderImage;
            if (!renderImage) throw new Error('Artifact planning requires an injected thumbnail renderer.');
            const input = { inputPath, width };
            collectArtifact(createBuildArtifact({ path: thumbnailRelPath, content: await renderImage(input), read: () => renderImage(input) }));
          }

          if (dryRun) {
            deps.logger.log(`${collectArtifact ? '[PLAN]' : '[DRY RUN]'} Would generate ${label} thumbnail: ${thumbnailRelPath}`);
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

      return generatedWidths;
    },
  };
}

function imagePipeline({ inputPath, width }: { inputPath: string; width: number }) {
  return sharp(inputPath).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 82 });
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
  getImageWidth: async (filePath: string) => {
    const metadata = await sharp(filePath).metadata();
    return metadata.width && metadata.width > 0 ? metadata.width : null;
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
    await imagePipeline({ inputPath, width }).toFile(outputPath);
  },
  renderImage: async (input) => imagePipeline(input).toBuffer(),
  readImage: readFile,
  logger: console,
});

export const collectSourceImages = defaultThumbnailGenerator.collectSourceImages;
export const generateImageThumbnails = defaultThumbnailGenerator.generateImageThumbnails;
