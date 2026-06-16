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
  function makeGenerator() {
    const tree: Record<string, FileEntry[]> = {
      root: [file('hero.png'), file('notes.txt'), directory('_thumbnails'), directory('gallery')],
      'root/_thumbnails': [file('hero-320.webp')],
      'root/gallery': [file('nested.jpg')],
    };
    const mkdir = vi.fn(async () => undefined);
    const processImage = vi.fn(async () => undefined);
    const logger = { log: vi.fn() };

    const generator = createThumbnailGenerator({
      exists: vi.fn(async (filePath: string) => Boolean(tree[filePath])),
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

    return { generator, mkdir, processImage, logger };
  }

  it('collects supported source images and skips generated thumbnails', async () => {
    const { generator } = makeGenerator();

    await expect(generator.collectSourceImages({ dir: 'root' })).resolves.toEqual(['hero.png', 'gallery/nested.jpg']);
  });

  it('injects image processing and directory creation for generated thumbnails', async () => {
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
