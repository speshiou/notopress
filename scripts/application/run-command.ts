import { select } from '@inquirer/prompts';
import type { Registry, Site } from '../../src/domain/registry';
import { createConfiguredPublisherAdapters } from '../adapters/catalog';
import type { CliCommand, SyncCommand } from '../cli/command';
import {
  createCoreBuildPlan,
  createPublicationPlan,
  formatPublicationPlan,
} from '../core/publishing/publication-plan';
import {
  createPublisherRegistry,
  executePublication,
  type PreparedPublisher,
  type SelectedPublisher,
} from '../core/publishing/publisher';
import { assertOperationPlanFingerprint } from '../core/publishing/operation-plan';
import { exists } from '../lib/files';
import { applyNativeSite } from '../infrastructure/native/storage';
import { configureLocalEnvironment, deployApplication } from '../infrastructure/vercel/deployment';
import { buildSite } from './build-site';

async function selectSite({
  registry,
  command,
}: {
  registry: Registry;
  command: CliCommand;
}): Promise<Site> {
  if (registry.sites.length === 0) throw new Error('No sites are configured in registry.json.');

  const selectedSiteId = command.siteId || await select({
    message: `Select a site for ${command.kind}:`,
    choices: registry.sites.map((site) => ({
      name: `${site.siteId} (${site.domain || 'no domain'})`,
      value: site.siteId,
      description: `Vault: ${site.vaultPath}`,
    })),
  });
  const site = registry.sites.find((candidate) => candidate.siteId === selectedSiteId);
  if (!site) throw new Error(`Site "${selectedSiteId}" was not found in registry.json.`);
  if (command.kind === 'configure') return site;
  if (!(await exists(site.vaultPath))) throw new Error(`The local vaultPath does not exist: ${site.vaultPath}`);
  if ((command.kind === 'sync' || command.kind === 'deploy') && !site.bucketName) {
    throw new Error(`"bucketName" is not configured for site [${site.siteId}].`);
  }
  return site;
}

function publisherRegistryFor(site: Site) {
  return createPublisherRegistry({ adapters: createConfiguredPublisherAdapters({ site }) });
}

async function runImport({ command, site, registry }: {
  command: Extract<CliCommand, { kind: 'import' }>;
  site: Site;
  registry: Registry;
}): Promise<void> {
  const adapter = publisherRegistryFor(site).get({ id: command.publisherId });
  if (!adapter.importResource) {
    throw new Error(`Publisher "${adapter.id}" does not support imports.`);
  }
  await adapter.importResource({
    site,
    registry,
    resource: command.resource,
    dryRun: command.dryRun,
  });
}

async function runStateInitialization({ command, site, registry }: {
  command: Extract<CliCommand, { kind: 'initialize-publisher-state' }>;
  site: Site;
  registry: Registry;
}): Promise<void> {
  const adapter = publisherRegistryFor(site).get({ id: command.publisherId });
  if (!adapter.initializeState) {
    throw new Error(`Publisher "${adapter.id}" does not support state initialization.`);
  }
  const build = await buildSite({ site, registry, dryRun: command.dryRun, verbose: command.verbose });
  await adapter.initializeState({
    site,
    registry,
    allIndices: build.allIndices,
    contentSnapshot: build.contentSnapshot,
    rootIndex: build.vaultRootIndex,
    dryRun: command.dryRun,
  });
}

async function runSync({ command, site, registry }: {
  command: SyncCommand;
  site: Site;
  registry: Registry;
}): Promise<void> {
  const build = await buildSite({ site, registry, dryRun: command.dryRun, verbose: command.verbose });
  const publisherRegistry = publisherRegistryFor(site);
  const preparedPublishers: PreparedPublisher<unknown>[] = [];
  for (const publisherId of command.publisherIds) {
    const adapter = publisherRegistry.get({ id: publisherId });
    const prepared = await adapter.preparePublication({
      site,
      registry,
      allIndices: build.allIndices,
      contentSnapshot: build.contentSnapshot,
      rootIndex: build.vaultRootIndex,
      targetSlugs: command.targetSlugs ? [...command.targetSlugs] : undefined,
      force: command.force,
      dryRun: command.dryRun,
    });
    if (prepared) preparedPublishers.push(prepared);
  }

  const corePlan = createCoreBuildPlan({
    contentSnapshot: build.contentSnapshot,
    rootIndex: build.vaultRootIndex,
    renderedArtifacts: build.renderedContent.artifacts,
    deleteRemoteFiles: command.deleteRemoteFiles,
  });
  const publicationPlan = createPublicationPlan({ corePlan, publishers: preparedPublishers });
  console.log(`\n${formatPublicationPlan({ plan: publicationPlan })}`);
  assertOperationPlanFingerprint({
    label: 'NotoPress publication',
    plan: publicationPlan,
    expectedFingerprint: command.expectedPlanFingerprint,
  });
  if (command.expectedPlanFingerprint) {
    console.log(`✅ NotoPress publication plan fingerprint matched: ${publicationPlan.fingerprint}`);
  }

  const selectedPublishers: SelectedPublisher[] = preparedPublishers.map((publisher) => ({ publisher }));
  await executePublication({
    publishers: selectedPublishers,
    applyCore: () => applyNativeSite({
      site,
      registry,
      dryRun: command.dryRun,
      deleteRemoteFiles: command.deleteRemoteFiles,
      verbose: command.verbose,
    }),
    dryRun: command.dryRun,
  });

  if (command.dryRun) {
    console.log('\n✅ Dry run completed successfully!');
    return;
  }
  console.log('\n✅ Sync and registry upload successfully completed!');
  if (command.kind === 'deploy') await deployApplication({ site, registry });
}

export async function runCommand({ command, registry }: { command: CliCommand; registry: Registry }): Promise<void> {
  if (command.dryRun) console.log('\n🏜️  DRY RUN MODE ENABLED - No changes will be made.');
  const site = await selectSite({ registry, command });
  if (command.kind === 'configure') {
    await configureLocalEnvironment({ site, registry });
    return;
  }
  if (command.kind === 'import') {
    await runImport({ command, site, registry });
    return;
  }
  if (command.kind === 'initialize-publisher-state') {
    await runStateInitialization({ command, site, registry });
    return;
  }
  await runSync({ command, site, registry });
}
