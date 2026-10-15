import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCommand } from './run-command';
import { buildSite } from './build-site';
import { prepareNativeSite } from '../infrastructure/native/storage';
import { createConfiguredPlatformAdapters } from '../adapters/catalog';
import { createOperationPlan } from '../core/publishing/operation-plan';
import { createNativeSitePlan, createPublicationPlan } from '../core/publishing/publication-plan';
import { passthroughStageTimer } from '../core/stage-timing';
import { prepareVaultInstructions } from '../infrastructure/native/vault-instructions';
import { configureLocalEnvironment } from '../infrastructure/vercel/deployment';
import { prepareSourceRepository } from '../infrastructure/native/source-repository';
import { exists } from '../core/files';
import type { ExecutableCommand, PublishCommand } from '../cli/command';
import type { VaultDirectoryIndex } from '../../src/lib/vault';

vi.mock('../infrastructure/native/vault-instructions', () => ({ prepareVaultInstructions: vi.fn() }));
vi.mock('../infrastructure/vercel/deployment', () => ({ configureLocalEnvironment: vi.fn(), deployApplication: vi.fn() }));
vi.mock('../infrastructure/native/source-repository', () => ({ prepareSourceRepository: vi.fn() }));
vi.mock('./build-site', () => ({ buildSite: vi.fn() }));
vi.mock('../infrastructure/native/storage', () => ({ prepareNativeSite: vi.fn() }));
vi.mock('../adapters/catalog', () => ({ createConfiguredPlatformAdapters: vi.fn() }));
vi.mock('../core/files', () => ({ exists: vi.fn(async () => true) }));

function setup() {
  vi.mocked(exists).mockResolvedValue(true);
  const instructions = { plan: createOperationPlan({ kind: 'notopress-vault-instructions', operations: [], serializeOperation: (operation) => operation }), apply: vi.fn(async () => undefined) };
  vi.mocked(prepareVaultInstructions).mockResolvedValue(instructions);
  const build = {
    allIndices: new Map<string, VaultDirectoryIndex>(), contentSnapshot: { documents: [] },
    vaultRootIndex: { version: 1, pages: [], directories: [], publicFiles: [] },
    renderedContent: { artifacts: [] }, generatedArtifacts: [], sourceArtifacts: [],
  };
  const storagePlan = createOperationPlan({ kind: 'notopress-storage-aws-cli', operations: [{ action: 'upload-registry', contentHash: 'a'.repeat(64) }], serializeOperation: (operation) => operation });
  const nativeStoragePlan = createOperationPlan({ kind: 'notopress-storage-aws-cli', operations: [], serializeOperation: (operation) => operation });
  const storage = { plan: nativeStoragePlan, apply: vi.fn(async () => undefined), close: vi.fn() };
  const publisher = {
    id: 'example-main', label: 'Example',
    plan: createOperationPlan({ kind: 'example-publisher', operations: [], serializeOperation: (operation) => operation }),
    apply: vi.fn(async () => undefined),
  };
  const adapter = { id: publisher.id, type: 'example', preparePublication: vi.fn(async () => publisher) };
  vi.mocked(buildSite).mockResolvedValue(build);
  vi.mocked(prepareNativeSite).mockResolvedValue(storage);
  vi.mocked(createConfiguredPlatformAdapters).mockReturnValue([adapter]);
  const site = { siteId: 'example-site', vaultPath: 'vault', bucketName: 'example-bucket' };
  const command: PublishCommand = { kind: 'publish', publisherId: publisher.id, targetSlugs: ['guides/article'], siteId: site.siteId, dryRun: true, verbose: false, force: false, deleteRemoteFiles: false };
  const nativeSitePlan = createNativeSitePlan({ contentSnapshot: build.contentSnapshot, rootIndex: build.vaultRootIndex, renderedArtifacts: [], deleteRemoteFiles: false });
  const reviewed = createPublicationPlan({ nativeSitePlan, nativeStoragePlan: storagePlan, publications: [publisher], localPlans: [{ id: 'notopress-vault-instructions', plan: instructions.plan }] });
  return { instructions, storage, publisher, adapter, command, site, reviewed };
}

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('composite storage publication ordering', () => {
  it('rejects changed storage operations before local or remote application and closes resources', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const h = setup();
    await expect(runCommand({ command: { ...h.command, dryRun: false, expectedPlanFingerprint: h.reviewed.fingerprint }, registry: { sites: [h.site] }, stageTimer: passthroughStageTimer })).rejects.toThrow('publication plan changed');
    expect(h.instructions.apply).not.toHaveBeenCalled();
    expect(h.storage.apply).not.toHaveBeenCalled();
    expect(h.publisher.apply).not.toHaveBeenCalled();
    expect(h.storage.close).toHaveBeenCalledOnce();
    expect(prepareNativeSite).toHaveBeenCalledWith(expect.objectContaining({ remindFullSync: true }));
    expect(buildSite).toHaveBeenCalledWith(expect.objectContaining({ prepareOnly: true }));
    expect(h.adapter.preparePublication).toHaveBeenCalledWith(expect.objectContaining({ targetSlugs: ['guides/article'] }));
  });
  it('propagates dry run to both executors after preparing all plans', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const h = setup();
    await runCommand({ command: h.command, registry: { sites: [h.site] }, stageTimer: passthroughStageTimer });
    expect(h.instructions.apply).toHaveBeenCalledExactlyOnceWith({ dryRun: true });
    expect(h.storage.apply).toHaveBeenCalledExactlyOnceWith({ dryRun: true });
    expect(h.publisher.apply).toHaveBeenCalledExactlyOnceWith({ dryRun: true });
    expect(h.storage.close).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Adapter selection: 1 requested source slug(s):\n  guides/article'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Source Markdown stays in Git. Storage uploads do not create adapter posts'));
    expect(prepareNativeSite).toHaveBeenCalledWith(expect.objectContaining({ scope: { kind: 'incremental', targetSlugs: ['guides/article'] } }));
  });
});

describe('vault interactions', () => {
  it.each(['configure', 'import', 'initialize-platform-state', 'initialize-sources'] as const)('updates instructions for %s without invoking storage', async (kind) => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const h = setup();
    const importResource = vi.fn(async () => undefined);
    const initializeState = vi.fn(async () => undefined);
    vi.mocked(createConfiguredPlatformAdapters).mockReturnValue([{ ...h.adapter, importResource, initializeState }]);
    const sourceApply = vi.fn(async () => undefined);
    vi.mocked(prepareSourceRepository).mockResolvedValue({ plan: createOperationPlan({ kind: 'source-git', operations: [], serializeOperation: (operation) => operation }), apply: sourceApply });
    const command: ExecutableCommand = { kind, publisherId: h.publisher.id, resource: 'article', siteId: h.site.siteId, dryRun: false, verbose: false };
    await runCommand({ command, registry: { sites: [h.site] }, stageTimer: passthroughStageTimer });
    expect(h.instructions.apply).toHaveBeenCalledExactlyOnceWith({ dryRun: false });
    expect(prepareNativeSite).not.toHaveBeenCalled();
    if (kind === 'configure') expect(configureLocalEnvironment).toHaveBeenCalledOnce();
    if (kind === 'import') expect(importResource).toHaveBeenCalledOnce();
    if (kind === 'initialize-platform-state') expect(initializeState).toHaveBeenCalledOnce();
    if (kind === 'initialize-sources') expect(sourceApply).toHaveBeenCalledOnce();
  });
  it('keeps runtime configuration available when the selected vault is not local', async () => {
    const h = setup();
    vi.mocked(exists).mockResolvedValue(false);
    await runCommand({ command: { kind: 'configure', siteId: h.site.siteId, dryRun: false, verbose: false }, registry: { sites: [h.site] } });
    expect(prepareVaultInstructions).not.toHaveBeenCalled();
    expect(configureLocalEnvironment).toHaveBeenCalledOnce();
  });
  it.each(['import', 'initialize-platform-state', 'initialize-sources'] as const)('only previews instructions for dry-run %s', async (kind) => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const h = setup();
    vi.mocked(createConfiguredPlatformAdapters).mockReturnValue([{ ...h.adapter, importResource: async () => undefined, initializeState: async () => undefined }]);
    vi.mocked(prepareSourceRepository).mockResolvedValue({ plan: createOperationPlan({ kind: 'source-git', operations: [], serializeOperation: (operation) => operation }), apply: vi.fn(async () => undefined) });
    await runCommand({ command: { kind, publisherId: h.publisher.id, resource: 'article', siteId: h.site.siteId, dryRun: true, verbose: false }, registry: { sites: [h.site] } });
    expect(h.instructions.apply).toHaveBeenCalledExactlyOnceWith({ dryRun: true });
  });
  it('rejects a stale source-setup fingerprint before instruction or Git writes', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const h = setup();
    const apply = vi.fn(async () => undefined);
    vi.mocked(prepareSourceRepository).mockResolvedValue({ plan: createOperationPlan({ kind: 'source-git', operations: [], serializeOperation: (operation) => operation }), apply });
    await expect(runCommand({ command: { kind: 'initialize-sources', siteId: h.site.siteId, dryRun: false, verbose: false, expectedPlanFingerprint: '0'.repeat(64) }, registry: { sites: [h.site] } })).rejects.toThrow('plan changed');
    expect(apply).not.toHaveBeenCalled();
    expect(h.instructions.apply).not.toHaveBeenCalled();
  });
});
