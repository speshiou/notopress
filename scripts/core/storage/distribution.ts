import { ROOT_JSON, INDEX_JSON, RENDERED_DIR, THUMBNAILS_DIR } from '../../../src/lib/constants';
import type { BuildArtifact } from '../content/build-artifact';
import { isGeneratedSitemapPath } from '../content/generated-paths';
import { isPublishableVaultPath } from './paths';
import { compareStrings } from '../order';

export type DistributionScope = { kind: 'full' } | { kind: 'incremental' } | { kind: 'assets'; paths: readonly string[] };

export function selectDistributionArtifacts({ generatedArtifacts, scope, publicFiles }: {
  generatedArtifacts: readonly BuildArtifact[];
  scope: DistributionScope;
  publicFiles: readonly string[];
}): { generated: readonly BuildArtifact[]; assets: readonly string[] } {
  if (scope.kind === 'assets') {
    const assets = [...new Set(scope.paths)].sort((left, right) => compareStrings({ left, right }));
    for (const asset of assets) {
      if (!isPublishableVaultPath(asset) || /\.md$/i.test(asset)) throw new Error('Invalid distribution asset.');
    }
    const paths = new Set(assets);
    return { generated: generatedArtifacts.filter((artifact) => paths.has(artifact.path)), assets };
  }
  // Native indexes advertise the whole site, so native publication must include its HTML and public files.
  const selected = generatedArtifacts.filter((artifact) => artifact.path.startsWith(`${RENDERED_DIR}/content/`));
  const assets = new Set(publicFiles.filter((file) => !/\.md$/i.test(file)).map((file) => `public/${file}`));
  for (const artifact of selected) {
    if (!artifact.distribution) throw new Error(`Missing rendered dependency metadata: ${artifact.path}.`);
    for (const asset of artifact.distribution.assets) assets.add(asset);
  }
  for (const asset of assets) if (!isPublishableVaultPath(asset) || /\.md$/i.test(asset)) throw new Error('Invalid distribution asset.');
  const selectedPaths = new Set(selected.map((artifact) => artifact.path));
  const generated = generatedArtifacts.filter((artifact) => selectedPaths.has(artifact.path) || assets.has(artifact.path)
    || artifact.path === ROOT_JSON
    || (artifact.path.startsWith('content/') && artifact.path.split('/').pop() === INDEX_JSON)
    || (artifact.path.startsWith('public/') && isGeneratedSitemapPath(artifact.path))
    || artifact.path.split('/').includes(THUMBNAILS_DIR));
  return { generated, assets: [...assets].sort((left, right) => compareStrings({ left, right })) };
}
