import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeStorage } from './initialize-storage';
import { buildSite } from './build-site';
import { prepareNativeBaseline } from '../infrastructure/native/storage-baseline';
import { readPendingStorageKeys } from '../infrastructure/native/pending-uploads';
import { createStorageBaselineInitializer } from '../core/storage/baseline';
import { artifact, createStorageHarness, target } from '../core/storage/publication.fixtures';
import { passthroughStageTimer } from '../core/stage-timing';
import type { InitializeStorageStateCommand } from '../cli/command';

vi.mock('./build-site', () => ({ buildSite: vi.fn() }));
vi.mock('../infrastructure/native/storage-baseline', () => ({ prepareNativeBaseline: vi.fn() }));
vi.mock('../infrastructure/native/pending-uploads', () => ({ readPendingStorageKeys: vi.fn() }));

async function setup() {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const h = createStorageHarness();
  const input = artifact();
  h.seed(input);
  const baseline = await createStorageBaselineInitializer({ remote: h.remote, newGeneration: () => 'generation' })({ target, artifacts: [input], pendingKeys: [input.key], trustLocal: true });
  const close = vi.fn();
  vi.mocked(prepareNativeBaseline).mockResolvedValue({ ...baseline, close });
  vi.mocked(readPendingStorageKeys).mockResolvedValue([input.key]);
  vi.mocked(buildSite).mockResolvedValue({ allIndices: new Map(), contentSnapshot: { documents: [] }, vaultRootIndex: { version: 1, pages: [], directories: [], publicFiles: [] }, renderedContent: { artifacts: [] }, generatedArtifacts: [], sourceArtifacts: [] });
  const site = { siteId: target.siteId, vaultPath: 'vault', bucketName: target.bucket };
  const command: InitializeStorageStateCommand = { kind: 'initialize-storage-state', siteId: site.siteId, trustLocal: true, pendingFile: 'pending.json', dryRun: true, verbose: false };
  return { h, baseline, close, site, command, registry: { sites: [site] }, stageTimer: passthroughStageTimer };
}

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('storage-only baseline orchestration', () => {
  it('prepares the canonical build read-only and preserves supplied pending keys in previews', async () => {
    const h = await setup();
    await initializeStorage(h);
    expect(buildSite).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true, prepareOnly: true }));
    expect(readPendingStorageKeys).toHaveBeenCalledWith({ filePath: 'pending.json' });
    expect(prepareNativeBaseline).toHaveBeenCalledWith(expect.objectContaining({ pendingKeys: [`${target.siteId}/content/article.md`], trustLocal: true }));
    expect(h.h.remote.writeManifest).not.toHaveBeenCalled();
    expect(h.close).toHaveBeenCalledOnce();
  });

  it('writes only the manifest with the reviewed fingerprint and closes after a stale-plan rejection', async () => {
    const h = await setup();
    await expect(initializeStorage({ ...h, command: { ...h.command, dryRun: false, expectedPlanFingerprint: '0'.repeat(64) } })).rejects.toThrow('plan changed');
    expect(h.h.remote.writeManifest).not.toHaveBeenCalled();
    await initializeStorage({ ...h, command: { ...h.command, dryRun: false, expectedPlanFingerprint: h.baseline.plan.fingerprint } });
    expect(buildSite).toHaveBeenLastCalledWith(expect.objectContaining({ dryRun: true, prepareOnly: true }));
    expect(h.h.remote.writeManifest).toHaveBeenCalledOnce();
    expect(h.h.remote.upload).not.toHaveBeenCalled();
    expect(h.h.remote.delete).not.toHaveBeenCalled();
    expect(h.h.materialize).not.toHaveBeenCalled();
    expect(h.close).toHaveBeenCalledTimes(2);
  });

  it('rejects missing trust or missing live fingerprint before any build or preparation', async () => {
    const h = await setup();
    await expect(initializeStorage({ ...h, command: { ...h.command, trustLocal: false } })).rejects.toThrow('--trust-local');
    await expect(initializeStorage({ ...h, command: { ...h.command, dryRun: false } })).rejects.toThrow('reviewed --expect');
    expect(buildSite).not.toHaveBeenCalled();
    expect(prepareNativeBaseline).not.toHaveBeenCalled();
  });
});
