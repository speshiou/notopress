import { describe, expect, it, vi } from 'vitest';
import { createNativeBaselinePreparation } from './storage-baseline';
import { createStorageHarness, target } from '../../core/storage/publication.fixtures';
import { passthroughStageTimer } from '../../core/stage-timing';

describe('native baseline preparation', () => {
  it('writes only the manifest and closes resources on preparation failure', async () => {
    const h = createStorageHarness();
    const close = vi.fn();
    const writeFile = vi.fn(async () => undefined);
    const prepare = createNativeBaselinePreparation({
      resolveConnection: () => ({ target, credentials: { accessKeyId: 'example-key', secretAccessKey: 'example-secret' } }),
      connect: () => ({ remote: h.remote, close }),
      createFiles: () => ({ listDirectory: async () => [], readFile: async () => Buffer.from(''), hashFile: async () => ({ size: 0, contentHash: 'a'.repeat(64) }), writeFile }),
      newGeneration: () => 'generation', logger: { log: vi.fn() },
    });
    const site = { siteId: target.siteId, vaultPath: 'vault', bucketName: target.bucket };
    const input = { site, registry: { sites: [site] }, generatedArtifacts: [], pendingKeys: [], trustLocal: true, stageTimer: passthroughStageTimer };
    const baseline = await prepare(input);
    await baseline.apply({ dryRun: true });
    expect(h.remote.writeManifest).not.toHaveBeenCalled();
    await baseline.apply({ dryRun: false, expectedFingerprint: baseline.plan.fingerprint });
    expect(h.remote.writeManifest).toHaveBeenCalledOnce();
    expect(writeFile).not.toHaveBeenCalled();
    expect(h.remote.upload).not.toHaveBeenCalled();
    expect(h.remote.hashObject).not.toHaveBeenCalled();
    baseline.close();
    await expect(prepare(input)).rejects.toThrow('already exists');
    expect(close).toHaveBeenCalledTimes(2);
  });
});
