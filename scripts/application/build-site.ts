import type { Registry, Site } from '../../src/domain/registry';
import { normalizeThumbnailSizes } from '../../src/lib/responsive-images';
import { hasConfiguredPlatformType } from '../adapters/catalog';
import { buildContentSnapshot } from '../core/content/content-snapshot';
import { generateRenderedContent } from '../core/content/rendered-content';
import { ensureVaultAgentRules } from './agent-rules';
import { generateIndices } from '../core/content/indices';
import { generateSitemaps } from '../core/content/sitemaps';
import type { StageTimer } from '../core/stage-timing';
import { publicationStageTimer } from '../infrastructure/stage-timing';
import type { BuildArtifact } from '../core/content/build-artifact';

export async function buildSite({
  site,
  registry,
  dryRun,
  verbose,
  stageTimer = publicationStageTimer,
  prepareOnly = false,
}: {
  site: Site;
  registry: Registry;
  dryRun: boolean;
  verbose: boolean;
  stageTimer?: StageTimer;
  prepareOnly?: boolean;
}) {
  const generatedArtifacts: BuildArtifact[] = [];
  const sourceArtifacts: BuildArtifact[] = [];
  const collectArtifact = prepareOnly ? (artifact: BuildArtifact) => { generatedArtifacts.push(artifact); } : undefined;
  const readOnly = dryRun || prepareOnly;
  const thumbnailSizes = normalizeThumbnailSizes(site.thumbnailSizes || registry.thumbnailSizes);
  await stageTimer.measure({
    stage: 'build.agent-rules',
    run: () => ensureVaultAgentRules({
      vaultPath: site.vaultPath,
      siteId: site.siteId,
      isWordPressEnabled: hasConfiguredPlatformType({ site, type: 'wordpress' }),
      dryRun: readOnly,
      collectArtifact,
    }),
  });

  const { rootContentIndex, vaultRootIndex, allIndices } = await stageTimer.measure({
    stage: 'build.indices',
    run: () => generateIndices({
      vaultPath: site.vaultPath,
      thumbnailSizes,
      noteIncludePaths: site.noteIncludePaths,
      rewrites: site.rewrites,
      dryRun: readOnly,
      verbose,
      stageTimer,
      collectArtifact,
      collectSourceArtifact: prepareOnly ? (artifact) => { sourceArtifacts.push(artifact); } : undefined,
    }),
  });
  const contentSnapshot = await stageTimer.measure({
    stage: 'build.snapshot', run: () => buildContentSnapshot({ vaultPath: site.vaultPath, allIndices }),
  });
  const renderedContent = await stageTimer.measure({
    stage: 'build.render',
    run: () => generateRenderedContent({
      vaultPath: site.vaultPath,
      siteId: site.siteId,
      imageHost: site.imageHost || registry.imageHost,
      allIndices,
      contentSnapshot,
      rootIndex: vaultRootIndex,
      thumbnailSizes,
      noteIncludePaths: site.noteIncludePaths,
      dryRun: readOnly,
      collectArtifact,
      collectSourceArtifact: prepareOnly ? (artifact) => { sourceArtifacts.push(artifact); } : undefined,
      distributionAssetPaths: generatedArtifacts.map((artifact) => artifact.path),
    }),
  });
  await stageTimer.measure({
    stage: 'build.sitemaps',
    run: () => generateSitemaps({
      vaultPath: site.vaultPath,
      domain: site.domain,
      rootContentIndex,
      allIndices,
      routes: vaultRootIndex.routes,
      dryRun: readOnly,
      collectArtifact,
    }),
  });

  return { allIndices, contentSnapshot, vaultRootIndex, renderedContent, generatedArtifacts, sourceArtifacts };
}
