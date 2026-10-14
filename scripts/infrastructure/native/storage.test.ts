import { describe, expect, it, vi } from 'vitest';
import { createNativeSitePreparation } from './storage';
import { passthroughStageTimer } from '../../core/stage-timing';
import { createStorageHarness, target } from '../../core/storage/publication.fixtures';

describe('native storage preparation', () => {
  it('closes the connection on failed preparation and does not mutate files or remote state', async () => {
    const h = createStorageHarness();
    h.remote.readManifest.mockRejectedValueOnce(new Error('read failed'));
    const close = vi.fn();
    const writeFile = vi.fn(async () => undefined);
    const prepare = createNativeSitePreparation({
      resolveConnection: () => ({ target, credentials: { accessKeyId: 'example-key', secretAccessKey: 'example-secret' } }),
      connect: () => ({ remote: h.remote, close }),
      createFiles: () => ({ listDirectory: async () => [], readFile: async () => new Uint8Array(), hashFile: async () => ({ size: 0, contentHash: 'a'.repeat(64) }), writeFile }),
      newGeneration: () => 'generation', logger: { log: vi.fn() },
    });
    const site = { siteId: target.siteId, vaultPath: 'vault', bucketName: target.bucket };
    await expect(prepare({ site, registry: { sites: [site] }, generatedArtifacts: [], deleteRemoteFiles: false, verbose: false, stageTimer: passthroughStageTimer })).rejects.toThrow('read failed');
    expect(close).toHaveBeenCalledOnce();
    expect(writeFile).not.toHaveBeenCalled();
    expect(h.remote.writeManifest).not.toHaveBeenCalled();
  });
});
