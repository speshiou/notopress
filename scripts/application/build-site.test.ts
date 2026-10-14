import { describe, expect, it, vi } from 'vitest';
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { buildSite } from './build-site';
import { passthroughStageTimer } from '../core/stage-timing';
import { createNativeSitePreparation } from '../infrastructure/native/storage';
import type { AwsCliRequest } from '../infrastructure/native/aws-cli';

const target = { endpoint: 'https://storage.example.com', bucket: 'example-bucket', siteId: 'example-site' };
import type { Site } from '../../src/domain/registry';

describe('portable prepared native builds', () => {
  it('prepares portable bytes, previews through AWS CLI without vault writes, and rejects changed source inputs', async () => {
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
        'root.json', 'content/index.json', '_rendered/content/article.html', 'public/sitemap.xml',
      ]));
      expect(firstBuild.generatedArtifacts.some((artifact) => artifact.path === 'AGENTS.md')).toBe(false);
      expect(firstBuild.generatedArtifacts.filter((artifact) => artifact.path.includes('_thumbnails/'))).toHaveLength(2);
      expect(firstBuild.sourceArtifacts.some((artifact) => artifact.path === '_includes/example-note.md')).toBe(true);
      for (const vault of [firstVault, secondVault]) {
        expect(await readdir(vault)).toEqual(['_includes', 'content']);
        expect(await readdir(path.join(vault, 'content'))).toEqual(['article.md', 'hero.png']);
        await expect(access(path.join(vault, 'root.json'))).rejects.toThrow();
      }

      const runCli = vi.fn(async ({ args }: AwsCliRequest) => args.includes('--dryrun')
        ? `(dryrun) upload: ${args[2]}_rendered/content/article.html to s3://${target.bucket}/${target.siteId}/_rendered/content/article.html\n`
        : '');
      const prepareNative = createNativeSitePreparation({
        resolveConnection: () => ({ target, credentials: { accessKeyId: 'example-key', secretAccessKey: 'example-secret' } }),
        runCli, environment: { NODE_ENV: 'test' }, logger: { log: vi.fn() },
      });
      const preview = await prepareNative({ site: firstSite, registry: { sites: [firstSite] }, generatedArtifacts: firstBuild.generatedArtifacts, contentSnapshot: firstBuild.contentSnapshot, sourceArtifacts: firstBuild.sourceArtifacts, deleteRemoteFiles: false, verbose: false, stageTimer: passthroughStageTimer });
      const live = await prepareNative({ site: secondSite, registry: { sites: [secondSite] }, generatedArtifacts: secondBuild.generatedArtifacts, contentSnapshot: secondBuild.contentSnapshot, sourceArtifacts: secondBuild.sourceArtifacts, deleteRemoteFiles: false, verbose: false, stageTimer: passthroughStageTimer });
      expect(live.plan.fingerprint).toBe(preview.plan.fingerprint);
      await preview.apply({ dryRun: true });
      expect(runCli.mock.calls.every(([request]) => request.args.includes('--dryrun'))).toBe(true);
      expect(await readdir(firstVault)).toEqual(['_includes', 'content']);
      await live.apply({ dryRun: false });
      expect(await readFile(path.join(secondVault, 'content/article.md'), 'utf8')).toBe(source);
      expect(await readFile(path.join(secondVault, 'content/hero.png'))).toEqual(image);

      const warm = await buildSite({ site: secondSite, registry: { sites: [secondSite] }, dryRun: true, prepareOnly: true, verbose: false, stageTimer: passthroughStageTimer });
      const warmPrepared = await prepareNative({ site: secondSite, registry: { sites: [secondSite] }, generatedArtifacts: warm.generatedArtifacts, contentSnapshot: warm.contentSnapshot, sourceArtifacts: warm.sourceArtifacts, deleteRemoteFiles: false, verbose: false, stageTimer: passthroughStageTimer });
      expect(warmPrepared.plan.fingerprint).toBe(preview.plan.fingerprint);
      runCli.mockClear();
      const migrated = await prepareNative({ site: firstSite, registry: { sites: [firstSite] }, generatedArtifacts: firstBuild.generatedArtifacts, contentSnapshot: firstBuild.contentSnapshot, sourceArtifacts: firstBuild.sourceArtifacts, deleteRemoteFiles: false, verbose: false, stageTimer: passthroughStageTimer });
      expect(migrated.plan.fingerprint).toBe(preview.plan.fingerprint);
      await writeFile(path.join(firstVault, '_includes/example-note.md'), 'Changed include body.');
      await expect(prepareNative({ site: firstSite, registry: { sites: [firstSite] }, generatedArtifacts: firstBuild.generatedArtifacts, contentSnapshot: firstBuild.contentSnapshot, sourceArtifacts: firstBuild.sourceArtifacts, deleteRemoteFiles: false, verbose: false, stageTimer: passthroughStageTimer })).rejects.toThrow('Build source changed during preparation');

      await writeFile(path.join(firstVault, '_includes/example-note.md'), '# Example Note\n\nIncluded body.');
      await preview.close(); await live.close(); await migrated.close(); await warmPrepared.close();
    } finally {
      log.mockRestore();
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});
