import { describe, expect, it, vi } from 'vitest';
import path from 'path';
import { createThumbnailGenerator } from './thumbnails';
import { type FileEntry } from './files';

function file(name: string): FileEntry {
  return { name, isDirectory: () => false, isFile: () => true };
}

function directory(name: string): FileEntry {
  return { name, isDirectory: () => true, isFile: () => false };
}

describe('createThumbnailGenerator', () => {
  function makeGenerator(statsMap: Record<string, { mtimeMs: number; size: number } | null> = {}) {
    const tree: Record<string, FileEntry[]> = {
      root: [file('hero.png'), file('notes.txt'), directory('_thumbnails'), directory('gallery')],
      'root/_thumbnails': [file('hero-320.webp')],
      'root/gallery': [file('nested.jpg')],
    };
    const mkdir = vi.fn(async () => undefined);
    const processImage = vi.fn(async () => undefined);
    const logger = { log: vi.fn() };

    const getFileStat = vi.fn(async (filePath: string) => {
      if (filePath in statsMap) return statsMap[filePath];
      return null;
    });

    const generator = createThumbnailGenerator({
      exists: vi.fn(async (filePath: string) => Boolean(tree[filePath])),
      getFileStat,
      readdir: vi.fn(async (filePath: string) => tree[filePath] || []),
      mkdir,
      joinPath: path.posix.join,
      relativePath: path.posix.relative,
      dirnamePath: path.posix.dirname,
      generatedThumbnailDir: '_thumbnails',
      normalizeThumbnailSizes: (sizes) => [...(sizes || [])].sort((a, b) => a - b),
      isSupportedResponsiveImage: (filePath) => ['.jpg', '.png'].includes(path.posix.extname(filePath)),
      isGeneratedThumbnailPath: (filePath) => filePath.split('/').includes('_thumbnails'),
      getThumbnailPath: ({ imagePath, width }) => `_thumbnails/${imagePath.replace(/\.[^.]+$/, `-${width}.webp`)}`,
      processImage,
      logger,
    });

    return { generator, mkdir, processImage, logger, getFileStat };
  }

  it('collects supported source images and skips generated thumbnails', async () => {
    const { generator } = makeGenerator();

    await expect(generator.collectSourceImages({ dir: 'root' })).resolves.toEqual(['hero.png', 'gallery/nested.jpg']);
  });

  it('injects image processing and directory creation for missing generated thumbnails', async () => {
    const { generator, mkdir, processImage } = makeGenerator();

    await generator.generateImageThumbnails({
      sourceDir: 'root',
      dryRun: false,
      thumbnailSizes: [640, 320],
      label: 'content',
    });

    expect(mkdir).toHaveBeenCalledWith('root/_thumbnails', { recursive: true });
    expect(processImage).toHaveBeenCalledWith({
      inputPath: 'root/hero.png',
      outputPath: 'root/_thumbnails/hero-320.webp',
      width: 320,
    });
    expect(processImage).toHaveBeenCalledTimes(4);
  });

  it('skips processing up-to-date thumbnails when thumbnail mtime is newer than source image', async () => {
    const statsMap = {
      'root/hero.png': { mtimeMs: 1000, size: 500 },
      'root/_thumbnails/hero-320.webp': { mtimeMs: 2000, size: 200 },
      'root/_thumbnails/hero-640.webp': { mtimeMs: 2000, size: 400 },
      'root/gallery/nested.jpg': { mtimeMs: 1000, size: 600 },
      'root/_thumbnails/gallery/nested-320.webp': { mtimeMs: 2000, size: 250 },
      'root/_thumbnails/gallery/nested-640.webp': { mtimeMs: 2000, size: 450 },
    };

    const { generator, processImage, logger } = makeGenerator(statsMap);

    await generator.generateImageThumbnails({
      sourceDir: 'root',
      dryRun: false,
      thumbnailSizes: [320, 640],
      label: 'content',
    });

    expect(processImage).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith('✨ All 4 content responsive image thumbnails are up to date.');
  });

  it('regenerates thumbnails when source image is newer than existing thumbnail', async () => {
    const statsMap = {
      'root/hero.png': { mtimeMs: 3000, size: 500 },
      'root/_thumbnails/hero-320.webp': { mtimeMs: 2000, size: 200 },
      'root/_thumbnails/hero-640.webp': { mtimeMs: 2000, size: 400 },
    };

    const { generator, processImage, logger } = makeGenerator(statsMap);

    await generator.generateImageThumbnails({
      sourceDir: 'root',
      dryRun: false,
      thumbnailSizes: [320],
      label: 'content',
    });

    expect(processImage).toHaveBeenCalledTimes(2); // hero-320 and nested-320 (nested was missing)
    expect(logger.log).toHaveBeenCalledWith(
      '✨ Generated 2 content responsive image thumbnails.'
    );
  });

  it('does not process images during dry runs', async () => {
    const { generator, mkdir, processImage, logger } = makeGenerator();

    await generator.generateImageThumbnails({
      sourceDir: 'root',
      dryRun: true,
      thumbnailSizes: [320],
      label: 'content',
    });

    expect(mkdir).not.toHaveBeenCalled();
    expect(processImage).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith('[DRY RUN] Would generate content thumbnail: _thumbnails/hero-320.webp');
  });
});
