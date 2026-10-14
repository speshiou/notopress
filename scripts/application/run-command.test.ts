import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCommand } from './run-command';
import { buildSite } from './build-site';
import { prepareNativeSite } from '../infrastructure/native/storage';
import { createConfiguredPlatformAdapters } from '../adapters/catalog';
import { createOperationPlan } from '../core/publishing/operation-plan';
import { createNativeSitePlan, createPublicationPlan } from '../core/publishing/publication-plan';
import { passthroughStageTimer } from '../core/stage-timing';
import type { PublishCommand } from '../cli/command';
import type { VaultDirectoryIndex } from '../../src/lib/vault';
import { initializeStorage } from './initialize-storage';

vi.mock('./build-site', () => ({ buildSite: vi.fn() }));
vi.mock('../infrastructure/native/storage', () => ({ prepareNativeSite: vi.fn() }));
vi.mock('../adapters/catalog', () => ({ createConfiguredPlatformAdapters: vi.fn() }));
vi.mock('../core/files', () => ({ exists: vi.fn(async () => true) }));
vi.mock('./initialize-storage', () => ({ initializeStorage: vi.fn() }));

function setup() {
  const build = {
    allIndices: new Map<string, VaultDirectoryIndex>(), contentSnapshot: { documents: [] },
    vaultRootIndex: { version: 1, pages: [], directories: [], publicFiles: [] },
    renderedContent: { artifacts: [] }, generatedArtifacts: [], sourceArtifacts: [],
  };
  const storagePlan = createOperationPlan({ kind: 'notopress-storage', operations: [{ manifestEtag: 'original', contentHash: 'a'.repeat(64) }], serializeOperation: (operation) => operation });
  const nativeStoragePlan = createOperationPlan({ kind: 'notopress-storage', operations: [], serializeOperation: (operation) => operation });
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
  const reviewed = createPublicationPlan({ nativeSitePlan, nativeStoragePlan: storagePlan, publications: [publisher] });
  return { storage, publisher, adapter, command, site, reviewed };
}

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('composite storage publication ordering', () => {
  it('routes storage initialization without preparing native uploads or publisher adapters', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const h = setup();
    await runCommand({ command: { kind: 'initialize-storage-state', siteId: h.site.siteId, trustLocal: true, pendingFile: 'pending.json', dryRun: true, verbose: false }, registry: { sites: [h.site] }, stageTimer: passthroughStageTimer });
    expect(initializeStorage).toHaveBeenCalledOnce();
    expect(buildSite).not.toHaveBeenCalled();
    expect(prepareNativeSite).not.toHaveBeenCalled();
    expect(createConfiguredPlatformAdapters).not.toHaveBeenCalled();
  });
  it('rejects changed storage operations before local or remote application and closes resources', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const h = setup();
    await expect(runCommand({ command: { ...h.command, dryRun: false, expectedPlanFingerprint: h.reviewed.fingerprint }, registry: { sites: [h.site] }, stageTimer: passthroughStageTimer })).rejects.toThrow('publication plan changed');
    expect(h.storage.apply).not.toHaveBeenCalled();
    expect(h.publisher.apply).not.toHaveBeenCalled();
    expect(h.storage.close).toHaveBeenCalledOnce();
    expect(buildSite).toHaveBeenCalledWith(expect.objectContaining({ prepareOnly: true }));
    expect(h.adapter.preparePublication).toHaveBeenCalledWith(expect.objectContaining({ targetSlugs: ['guides/article'] }));
  });
  it('propagates dry run to both executors after preparing all plans', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const h = setup();
    await runCommand({ command: h.command, registry: { sites: [h.site] }, stageTimer: passthroughStageTimer });
    expect(h.storage.apply).toHaveBeenCalledExactlyOnceWith({ dryRun: true });
    expect(h.publisher.apply).toHaveBeenCalledExactlyOnceWith({ dryRun: true });
    expect(h.storage.close).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Adapter selection: 1 requested source slug(s):\n  guides/article'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Selected slugs limit adapter posts only; storage uploads do not create adapter posts'));
  });
});
