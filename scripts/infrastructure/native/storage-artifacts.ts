import path from 'node:path';
import type { Registry, Site } from '../../../src/domain/registry';
import { DEFAULT_REGISTRY_FILENAME } from '../../../src/lib/constants';
import { createBuildArtifact, type BuildArtifact } from '../../core/content/build-artifact';
import type { ContentSnapshot } from '../../core/content/content-snapshot';
import { assertInventorySourceHashes } from '../../core/storage/inventory';
import { getStorageKey } from '../../core/storage/paths';
import { isPublishableVaultPath } from '../../core/storage/paths';
import { selectDistributionArtifacts, type DistributionScope } from '../../core/storage/distribution';
import { mapWithConcurrency } from '../../core/concurrency';
import { compareStrings } from '../../core/order';
import type { StageTimer } from '../../core/stage-timing';
import { createVaultStorageInventory, type VaultStorageFiles } from './vault-inventory';

export type NativeStorageBuildInput = {
  site: Site;
  registry: Registry;
  generatedArtifacts: readonly BuildArtifact[];
  contentSnapshot?: ContentSnapshot;
  sourceArtifacts?: readonly BuildArtifact[];
  stageTimer: StageTimer;
  scope?: DistributionScope;
  publicFiles?: readonly string[];
};

export async function prepareStorageArtifacts({ input, files }: {
  input: NativeStorageBuildInput;
  files: VaultStorageFiles;
}) {
  const { site, registry, generatedArtifacts, contentSnapshot, sourceArtifacts = [], stageTimer } = input;
  const inventory = createVaultStorageInventory(files);
  const sources = [
    ...(contentSnapshot?.documents || []).map((document) => ({ path: path.relative(site.vaultPath, document.localPath).replace(/\\/g, '/'), contentHash: document.sourceHash })),
    ...sourceArtifacts,
  ];
  async function verifySources() {
    const actual = await mapWithConcurrency({ items: sources, concurrency: 8, worker: async (source) => {
      if (!isPublishableVaultPath(source.path)) throw new Error('Invalid build source path.');
      return { path: source.path, ...await files.hashFile(source.path), read: () => files.readFile(source.path) };
    } });
    assertInventorySourceHashes({ artifacts: actual, sources });
  }
  const distribution = selectDistributionArtifacts({ generatedArtifacts, scope: input.scope || { kind: 'full' }, publicFiles: input.publicFiles || [] });
  const local = await stageTimer.measure({ stage: 'storage.inventory', run: async () => {
    await verifySources();
    const artifacts = new Map(distribution.generated.map((artifact) => [artifact.path, artifact]));
    if (artifacts.size !== distribution.generated.length) throw new Error('Duplicate distribution artifact.');
    for (const asset of distribution.assets) {
      if (artifacts.has(asset)) continue;
      let hash: { size: number; contentHash: string };
      try { hash = await files.hashFile(asset); }
      catch { throw new Error(`Cannot prepare required distribution asset: ${asset}. Restore its source or generated file before publishing.`); }
      const artifact: BuildArtifact = { path: asset, ...hash, read: () => files.readFile(asset) };
      artifact.verify = async () => assertInventorySourceHashes({ artifacts: [{ ...artifact, ...await files.hashFile(asset) }], sources: [artifact] });
      artifacts.set(asset, artifact);
    }
    for (const artifact of artifacts.values()) if (!isPublishableVaultPath(artifact.path)) throw new Error('Invalid distribution path.');
    return [...artifacts.values()].sort((left, right) => compareStrings({ left: left.path, right: right.path }));
  } });
  const registryArtifact = createBuildArtifact({ path: DEFAULT_REGISTRY_FILENAME, content: JSON.stringify({
    sites: registry.sites.filter((candidate) => candidate.bucketName === site.bucketName)
      .map((candidate) => ({ domain: candidate.domain, siteId: candidate.siteId }))
      .sort((left, right) => compareStrings({ left: left.siteId, right: right.siteId })),
  }, null, 2) });
  return {
    artifacts: [
      ...local.map((artifact) => ({ ...artifact, key: getStorageKey({ siteId: site.siteId, path: artifact.path }) })),
      { ...registryArtifact, key: DEFAULT_REGISTRY_FILENAME },
    ],
    materialize: () => inventory.materialize(distribution.generated),
    verifySources,
  };
}
