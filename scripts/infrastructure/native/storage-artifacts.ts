import path from 'node:path';
import type { Registry, Site } from '../../../src/domain/registry';
import { DEFAULT_REGISTRY_FILENAME } from '../../../src/lib/constants';
import { createBuildArtifact, type BuildArtifact } from '../../core/content/build-artifact';
import type { ContentSnapshot } from '../../core/content/content-snapshot';
import { assertInventorySourceHashes } from '../../core/storage/inventory';
import { getStorageKey } from '../../core/storage/paths';
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
};

export async function prepareStorageArtifacts({ input, files }: {
  input: NativeStorageBuildInput;
  files: VaultStorageFiles;
}) {
  const { site, registry, generatedArtifacts, contentSnapshot, sourceArtifacts = [], stageTimer } = input;
  const inventory = createVaultStorageInventory(files);
  const local = await stageTimer.measure({ stage: 'storage.inventory', run: () => inventory.collect({ generatedArtifacts }) });
  assertInventorySourceHashes({ artifacts: local, sources: [
    ...(contentSnapshot?.documents || []).map((document) => ({ path: path.relative(site.vaultPath, document.localPath).replace(/\\/g, '/'), contentHash: document.sourceHash })),
    ...sourceArtifacts,
  ] });
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
    materialize: () => inventory.materialize(generatedArtifacts),
  };
}
