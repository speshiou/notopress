import { describe, expect, it, vi } from 'vitest';
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { buildSite } from './build-site';
import { passthroughStageTimer } from '../core/stage-timing';
import { createVaultStorageFiles, createVaultStorageInventory } from '../infrastructure/native/vault-inventory';
import { createNativeSitePreparation } from '../infrastructure/native/storage';
import { createStorageHarness, target } from '../core/storage/publication.fixtures';
import type { Site } from '../../src/domain/registry';

describe('portable prepared native builds', () => {
  it('prepares identical dry/live bytes on two machines, writes no previews, and reuses remote state without listing', async () => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'notopress-portable-'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const firstVault = path.join(fixtureRoot, 'first-vault');
      const secondVault = path.join(fixtureRoot, 'second-vault');
      await mkdir(path.join(firstVault, 'content'), { recursive: true });
      const source = '---\ntitle: Example\ndate: 2026-01-01\nupdated: 2026-01-02\n---\n# Example\n\n![Example](hero.png)\n\nBody.\n\n![[example-note]]\n';
      await writeFile(path.join(firstVault, 'content/article.md'), source);
      const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#808080' } }).png().toBuffer();
      await writeFile(path.join(firstVault, 'content/hero.png'), image);
      await mkdir(path.join(firstVault, '_includes'));
      await writeFile(path.join(firstVault, '_includes/example-note.md'), '# Example Note\n\nIncluded body.');
      await cp(firstVault, secondVault, { recursive: true });
      const firstSite: Site = { siteId: target.siteId, vaultPath: firstVault, bucketName: target.bucket, domain: 'example.com', thumbnailSizes: [8, 16], noteIncludePaths: ['_includes'] };
      const secondSite: Site = { ...firstSite, vaultPath: secondVault };
      const firstBuild = await buildSite({ site: firstSite, registry: { sites: [firstSite] }, dryRun: true, prepareOnly: true, verbose: false, stageTimer: passthroughStageTimer });
      const secondBuild = await buildSite({ site: secondSite, registry: { sites: [secondSite] }, dryRun: false, prepareOnly: true, verbose: false, stageTimer: passthroughStageTimer });
      expect(firstBuild.generatedArtifacts.map(({ path, size, contentHash }) => ({ path, size, contentHash })))
        .toEqual(secondBuild.generatedArtifacts.map(({ path, size, contentHash }) => ({ path, size, contentHash })));
      expect(firstBuild.generatedArtifacts.map((artifact) => artifact.path)).toEqual(expect.arrayContaining([
        'AGENTS.md', 'root.json', 'content/index.json', '_rendered/content/article.html', 'public/sitemap.xml',
      ]));
      expect(firstBuild.generatedArtifacts.filter((artifact) => artifact.path.includes('_thumbnails/'))).toHaveLength(2);
      expect(firstBuild.sourceArtifacts.some((artifact) => artifact.path === '_includes/example-note.md')).toBe(true);
      for (const vault of [firstVault, secondVault]) {
        expect(await readdir(vault)).toEqual(['_includes', 'content']);
        expect(await readdir(path.join(vault, 'content'))).toEqual(['article.md', 'hero.png']);
        await expect(access(path.join(vault, 'root.json'))).rejects.toThrow();
      }

      const h = createStorageHarness();
      const close = vi.fn();
      const prepareNative = createNativeSitePreparation({
        resolveConnection: () => ({ target, credentials: { accessKeyId: 'example-key', secretAccessKey: 'example-secret' } }),
        connect: () => ({ remote: h.remote, close }),
        createFiles: (vaultPath) => createVaultStorageFiles({ vaultPath }),
        newGeneration: () => 'generation', logger: { log: vi.fn() },
      });
      const preview = await prepareNative({ site: firstSite, registry: { sites: [firstSite] }, generatedArtifacts: firstBuild.generatedArtifacts, contentSnapshot: firstBuild.contentSnapshot, sourceArtifacts: firstBuild.sourceArtifacts, deleteRemoteFiles: false, verbose: false, stageTimer: passthroughStageTimer });
      const live = await prepareNative({ site: secondSite, registry: { sites: [secondSite] }, generatedArtifacts: secondBuild.generatedArtifacts, contentSnapshot: secondBuild.contentSnapshot, sourceArtifacts: secondBuild.sourceArtifacts, deleteRemoteFiles: false, verbose: false, stageTimer: passthroughStageTimer });
      expect(live.plan.fingerprint).toBe(preview.plan.fingerprint);
      await preview.apply({ dryRun: true });
      expect(h.remote.writeManifest).not.toHaveBeenCalled();
      expect(await readdir(firstVault)).toEqual(['_includes', 'content']);
      await live.apply({ dryRun: false });
      expect(await readFile(path.join(secondVault, 'content/article.md'), 'utf8')).toBe(source);
      expect(await readFile(path.join(secondVault, 'content/hero.png'))).toEqual(image);

      const warm = await buildSite({ site: secondSite, registry: { sites: [secondSite] }, dryRun: true, prepareOnly: true, verbose: false, stageTimer: passthroughStageTimer });
      const inventory = createVaultStorageInventory(createVaultStorageFiles({ vaultPath: secondVault }));
      const warmObjects = await inventory.collect({ generatedArtifacts: warm.generatedArtifacts });
      const coldObjects = await createVaultStorageInventory(createVaultStorageFiles({ vaultPath: firstVault })).collect({ generatedArtifacts: firstBuild.generatedArtifacts });
      expect(warmObjects.map(({ path, size, contentHash }) => ({ path, size, contentHash })))
        .toEqual(coldObjects.map(({ path, size, contentHash }) => ({ path, size, contentHash })));
      h.remote.listObjects.mockClear();
      h.remote.upload.mockClear();
      h.remote.writeManifest.mockClear();
      const migrated = await prepareNative({ site: firstSite, registry: { sites: [firstSite] }, generatedArtifacts: firstBuild.generatedArtifacts, contentSnapshot: firstBuild.contentSnapshot, sourceArtifacts: firstBuild.sourceArtifacts, deleteRemoteFiles: false, verbose: false, stageTimer: passthroughStageTimer });
      expect(h.remote.listObjects).not.toHaveBeenCalled();
      expect(migrated.plan.operations.filter((operation) => operation.action === 'upload')).toEqual([]);
      await migrated.apply({ dryRun: false });
      expect(h.remote.upload).not.toHaveBeenCalled();
      expect(h.remote.writeManifest).not.toHaveBeenCalled();
      h.remote.readManifest.mockClear();
      await writeFile(path.join(firstVault, '_includes/example-note.md'), 'Changed include body.');
      await expect(prepareNative({ site: firstSite, registry: { sites: [firstSite] }, generatedArtifacts: firstBuild.generatedArtifacts, contentSnapshot: firstBuild.contentSnapshot, sourceArtifacts: firstBuild.sourceArtifacts, deleteRemoteFiles: false, verbose: false, stageTimer: passthroughStageTimer })).rejects.toThrow('Build source changed during preparation');
      expect(h.remote.readManifest).not.toHaveBeenCalled();
      await writeFile(path.join(firstVault, '_includes/example-note.md'), '# Example Note\n\nIncluded body.');
      preview.close(); live.close(); migrated.close();
      expect(close).toHaveBeenCalledTimes(4);
    } finally {
      log.mockRestore();
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});
