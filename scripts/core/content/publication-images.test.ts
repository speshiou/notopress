import { describe, expect, it, vi } from 'vitest';
import { createPublicationImagePreparation } from './publication-images';
import { createBuildArtifact } from './build-artifact';
import type { generateImageThumbnails } from './thumbnails';

describe('publication image preparation', () => {
  it('shares concurrent image preparation and tracks content and public inputs', async () => {
    const generateThumbnails = vi.fn<typeof generateImageThumbnails>(async (input) => {
      const image = input.imageFiles?.[0] || '';
      input.collectSourceArtifact?.(createBuildArtifact({ path: image, content: 'source' }));
      input.collectArtifact?.(createBuildArtifact({ path: `_thumbnails/${image}-8.webp`, content: 'thumbnail' }));
      return { [image]: [8] };
    });
    const prepare = createPublicationImagePreparation({
      vaultPath: 'vault', thumbnailSizes: [8], publicFiles: ['public.png', 'shared.png'],
      assetFiles: ['hero.png', 'public.png', 'shared.png'], generateThumbnails,
      fileExists: async (file) => file !== 'vault/content/public.png',
    });
    const [first, second] = await Promise.all([
      prepare({ paths: ['hero.png', 'hero.png', 'external.svg', '_thumbnails/hero-8.webp'] }),
      prepare({ paths: ['hero.png', 'public.png', 'shared.png'] }),
    ]);
    expect(generateThumbnails).toHaveBeenCalledTimes(3);
    expect(first.responsiveImageWidths).toEqual({ 'hero.png': [8] });
    expect(second.sourceArtifacts.map((artifact) => artifact.path)).toEqual(['content/hero.png', 'public/public.png', 'content/shared.png']);
    expect(second.generatedArtifacts.map((artifact) => artifact.path)).toEqual([
      'content/_thumbnails/hero.png-8.webp', 'public/_thumbnails/public.png-8.webp', 'content/_thumbnails/shared.png-8.webp',
    ]);
    expect(generateThumbnails.mock.calls.every(([input]) => input.dryRun)).toBe(true);
  });

  it('rejects traversal before reading or generating images', async () => {
    const fileExists = vi.fn(async () => true);
    const prepare = createPublicationImagePreparation({ vaultPath: 'vault', thumbnailSizes: [8], publicFiles: [], assetFiles: [], fileExists });
    await expect(prepare({ paths: ['../private.png'] })).rejects.toThrow('Invalid publication image path');
    expect(fileExists).not.toHaveBeenCalled();
  });
});
