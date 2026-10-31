import path from 'node:path';
import { isSupportedResponsiveImage, isGeneratedThumbnailPath } from '../../../src/lib/responsive-images';
import { exists } from '../files';
import { isPublishableVaultPath } from '../storage/paths';
import { generateImageThumbnails } from './thumbnails';
import type { BuildArtifact } from './build-artifact';

export type PreparedPublicationImages = {
  responsiveImageWidths: Record<string, number[]>;
  generatedArtifacts: BuildArtifact[];
  sourceArtifacts: BuildArtifact[];
};

export type PreparePublicationImages = (input: { paths: readonly string[] }) => Promise<PreparedPublicationImages>;

/** One publication's image work, shared across selected posts without a persistent cache. */
export function createPublicationImagePreparation({ vaultPath, thumbnailSizes, publicFiles, assetFiles,
  generateThumbnails = generateImageThumbnails, fileExists = exists,
}: {
  vaultPath: string;
  thumbnailSizes: readonly number[];
  publicFiles: readonly string[];
  assetFiles: readonly string[];
  generateThumbnails?: typeof generateImageThumbnails;
  fileExists?: typeof exists;
}): PreparePublicationImages {
  const cache = new Map<string, Promise<PreparedPublicationImages>>();
  const publicPaths = new Set(publicFiles);
  const availablePaths = new Set(assetFiles);
  return async ({ paths }) => {
    const results: PreparedPublicationImages[] = [];
    for (const imagePath of [...new Set(paths)].sort()) {
      if (!isPublishableVaultPath(imagePath)) throw new Error(`Invalid publication image path: ${imagePath}.`);
      if (!isSupportedResponsiveImage(imagePath) || isGeneratedThumbnailPath(imagePath)) continue;
      let prepared = cache.get(imagePath);
      if (!prepared) {
        prepared = (async () => {
          const generatedArtifacts: BuildArtifact[] = [];
          const sourceArtifacts: BuildArtifact[] = [];
          // Match the full build's content-over-public width precedence.
          const root = availablePaths.has(imagePath) && await fileExists(path.join(vaultPath, 'content', imagePath))
            ? 'content' : publicPaths.has(imagePath) ? 'public' : undefined;
          if (!root) return { responsiveImageWidths: {}, generatedArtifacts, sourceArtifacts };
          const responsiveImageWidths = await generateThumbnails({
            sourceDir: path.join(vaultPath, root), dryRun: true, thumbnailSizes, label: root,
            imageFiles: [imagePath],
            collectArtifact: (artifact) => { generatedArtifacts.push({ ...artifact, path: `${root}/${artifact.path}` }); },
            collectSourceArtifact: (artifact) => { sourceArtifacts.push({ ...artifact, path: `${root}/${artifact.path}` }); },
          });
          return { responsiveImageWidths, generatedArtifacts, sourceArtifacts };
        })();
        cache.set(imagePath, prepared);
      }
      results.push(await prepared);
    }
    return {
      responsiveImageWidths: Object.assign({}, ...results.map((result) => result.responsiveImageWidths)),
      generatedArtifacts: results.flatMap((result) => result.generatedArtifacts),
      sourceArtifacts: results.flatMap((result) => result.sourceArtifacts),
    };
  };
}
