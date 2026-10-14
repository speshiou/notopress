import { describe, expect, it, vi } from 'vitest';
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { buildSite } from './build-site';
import { createNativeSitePreparation, type NativeStoragePreparationDeps } from '../infrastructure/native/storage';
import { createNativeBaselinePreparation } from '../infrastructure/native/storage-baseline';
import { createVaultStorageFiles } from '../infrastructure/native/vault-inventory';
import { createStorageHarness, target } from '../core/storage/publication.fixtures';
import { passthroughStageTimer } from '../core/stage-timing';
import type { Site } from '../../src/domain/registry';

describe('baseline adoption with a canonical build and an empty-cache machine', () => {
  it('preserves pending source/rendered bytes, writes only state, and starts incremental publishing without site reads', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'notopress-baseline-'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('Unexpected network request'); });
    try {
      const site: Site = { siteId: target.siteId, bucketName: target.bucket, vaultPath: path.join(root, 'first'), domain: 'example.invalid', thumbnailSizes: [8] };
      await mkdir(path.join(site.vaultPath, 'content'), { recursive: true });
      const initial = '---\ntitle: Example\ndate: 2026-01-01\nupdated: 2026-01-02\n---\n# Example\n\nFirst body.\n';
      await writeFile(path.join(site.vaultPath, 'content/article.md'), initial);
      const h = createStorageHarness();
      const deps: NativeStoragePreparationDeps = {
        resolveConnection: () => ({ target, credentials: { accessKeyId: 'example-key', secretAccessKey: 'example-secret' } }),
        connect: () => ({ remote: h.remote, close: () => undefined }), createFiles: (vaultPath) => createVaultStorageFiles({ vaultPath }),
        newGeneration: () => 'generation', logger: { log: () => undefined },
      };
      const prepareSite = createNativeSitePreparation(deps);
      const prepareBaseline = createNativeBaselinePreparation(deps);
      const build = (selected: Site) => buildSite({ site: selected, registry: { sites: [selected] }, dryRun: true, prepareOnly: true, verbose: false, stageTimer: passthroughStageTimer });
      const firstBuild = await build(site);
      const seed = await prepareSite({ site, registry: { sites: [site] }, ...firstBuild, deleteRemoteFiles: false, verbose: false, stageTimer: passthroughStageTimer });
      await seed.apply({ dryRun: false });
      h.setSnapshot(null); // Existing storage from a pre-manifest workflow.
      const updated = initial.replace('First body.', 'Other body.');
      await writeFile(path.join(site.vaultPath, 'content/article.md'), updated);
      const other: Site = { ...site, vaultPath: path.join(root, 'second') };
      await mkdir(other.vaultPath);
      await cp(path.join(site.vaultPath, 'content'), path.join(other.vaultPath, 'content'), { recursive: true });
      const coldBuild = await build(other);
      const pendingKeys = [`${target.siteId}/content/article.md`, `${target.siteId}/_rendered/content/article.html`];
      h.remote.hashObject.mockClear(); h.remote.upload.mockClear(); h.remote.delete.mockClear(); h.remote.writeManifest.mockClear();
      const before = await readdir(other.vaultPath);
      const baseline = await prepareBaseline({ site: other, registry: { sites: [other] }, ...coldBuild, trustLocal: true, pendingKeys, stageTimer: passthroughStageTimer });
      await baseline.apply({ dryRun: true });
      expect(h.remote.writeManifest).not.toHaveBeenCalled();
      await baseline.apply({ dryRun: false, expectedFingerprint: baseline.plan.fingerprint });
      expect(h.remote.writeManifest).toHaveBeenCalledOnce();
      expect(h.remote.hashObject).not.toHaveBeenCalled();
      expect(h.remote.upload).not.toHaveBeenCalled();
      expect(h.remote.delete).not.toHaveBeenCalled();
      expect(await readdir(other.vaultPath)).toEqual(before);
      await expect(access(path.join(other.vaultPath, 'root.json'))).rejects.toThrow();
      expect(Buffer.from(h.objects.get(pendingKeys[0])?.bytes || []).toString()).toBe(initial);
      h.remote.listObjects.mockClear();
      const incremental = await prepareSite({ site: other, registry: { sites: [other] }, ...coldBuild, deleteRemoteFiles: false, verbose: false, stageTimer: passthroughStageTimer });
      expect(h.remote.listObjects).not.toHaveBeenCalled();
      expect(h.remote.hashObject.mock.calls.map(([entry]) => entry.key)).toEqual(['registry.json']);
      expect(incremental.plan.operations.filter((operation) => operation.action === 'upload').map((operation) => 'key' in operation ? operation.key : '')).toEqual([pendingKeys[1], pendingKeys[0]]);
      await incremental.apply({ dryRun: true });
      expect(h.remote.upload).not.toHaveBeenCalled();
      await incremental.apply({ dryRun: false });
      expect(h.remote.upload).toHaveBeenCalledTimes(2);
      expect(Buffer.from(h.objects.get(pendingKeys[0])?.bytes || []).toString()).toBe(updated);
      expect(Buffer.from(h.objects.get(pendingKeys[1])?.bytes || []).toString()).toContain('Other body.');
      expect(await readFile(path.join(other.vaultPath, 'content/article.md'), 'utf8')).toBe(updated);
      baseline.close(); incremental.close(); seed.close();
    } finally {
      log.mockRestore(); fetch.mockRestore(); await rm(root, { recursive: true, force: true });
    }
  });
});
