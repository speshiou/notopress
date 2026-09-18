import type { Registry, Site } from '../../src/domain/registry';
import { normalizeThumbnailSizes } from '../../src/lib/responsive-images';
import { hasConfiguredPublisherType } from '../adapters/catalog';
import { buildContentSnapshot } from '../core/content/content-snapshot';
import { generateRenderedContent } from '../core/content/rendered-content';
import { ensureVaultAgentRules } from '../lib/agent-rules';
import { generateIndices } from '../lib/indices';
import { generateSitemaps } from '../lib/sitemaps';

export async function buildSite({
  site,
  registry,
  dryRun,
  verbose,
}: {
  site: Site;
  registry: Registry;
  dryRun: boolean;
  verbose: boolean;
}) {
  const thumbnailSizes = normalizeThumbnailSizes(site.thumbnailSizes || registry.thumbnailSizes);
  await ensureVaultAgentRules({
    vaultPath: site.vaultPath,
    siteId: site.siteId,
    isWordPressEnabled: hasConfiguredPublisherType({ site, type: 'wordpress' }),
    dryRun,
  });

  const { rootContentIndex, vaultRootIndex, allIndices } = await generateIndices({
    vaultPath: site.vaultPath,
    thumbnailSizes,
    noteIncludePaths: site.noteIncludePaths,
    rewrites: site.rewrites,
    dryRun,
    verbose,
  });
  const contentSnapshot = await buildContentSnapshot({ vaultPath: site.vaultPath, allIndices });
  const renderedContent = await generateRenderedContent({
    vaultPath: site.vaultPath,
    siteId: site.siteId,
    imageHost: site.imageHost || registry.imageHost,
    allIndices,
    contentSnapshot,
    rootIndex: vaultRootIndex,
    thumbnailSizes,
    noteIncludePaths: site.noteIncludePaths,
    dryRun,
  });
  await generateSitemaps({
    vaultPath: site.vaultPath,
    domain: site.domain,
    rootContentIndex,
    allIndices,
    routes: vaultRootIndex.routes,
    dryRun,
  });

  return { allIndices, contentSnapshot, vaultRootIndex, renderedContent };
}
