import { ROOT_JSON, INDEX_JSON, RENDERED_DIR, THUMBNAILS_DIR } from '../../../src/lib/constants';
import type { BuildArtifact } from '../content/build-artifact';
import { isGeneratedSitemapPath } from '../content/generated-paths';
import { isPublishableVaultPath } from './paths';
import { compareStrings } from '../order';

export type DistributionScope = { kind: 'full' } | { kind: 'incremental'; targetSlugs?: readonly string[] };

export function selectDistributionArtifacts({ generatedArtifacts, scope, publicFiles }: {
  generatedArtifacts: readonly BuildArtifact[];
  scope: DistributionScope;
  publicFiles: readonly string[];
}): { generated: readonly BuildArtifact[]; assets: readonly string[] } {
  const rendered = generatedArtifacts.filter((artifact) => artifact.path.startsWith(`${RENDERED_DIR}/content/`));
  const requested = scope.kind === 'incremental' && scope.targetSlugs?.length ? new Set(scope.targetSlugs) : undefined;
  if (requested) {
    for (const slug of requested) {
      if (!rendered.some((artifact) => artifact.distribution?.sourceSlug === slug)) throw new Error(`Missing rendered publication: ${slug}.`);
    }
  }
  const selected = rendered.filter((artifact) => !requested || artifact.distribution?.noteSlugs.some((slug) => requested.has(slug)));
  const assets = new Set(scope.kind === 'full' ? publicFiles.filter((file) => !/\.md$/i.test(file)).map((file) => `public/${file}`) : []);
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
    || (scope.kind === 'full' && artifact.path.split('/').includes(THUMBNAILS_DIR)));
  return { generated, assets: [...assets].sort((left, right) => compareStrings({ left, right })) };
}
