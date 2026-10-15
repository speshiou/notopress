import { describe, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createNativeSitePreparation } from './storage';
import { createBuildArtifact } from '../../core/content/build-artifact';
import { passthroughStageTimer } from '../../core/stage-timing';
import { NOTOPRESS_DIR } from '../../../src/lib/constants';

describe('site-wide incremental asset transfers', () => {
  it('reduces 2,072 required assets to zero unchanged transfers or one replacement, and preserves portable upload records', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'notopress-storage-cache-'));
    const remote = new Map<string, Buffer>();
    const attempted: string[][] = [];
    async function filesUnder(directory: string, relative = ''): Promise<string[]> {
      const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
      return (await Promise.all(entries.map((entry) => {
        const file = path.posix.join(relative, entry.name);
        return entry.isDirectory() ? filesUnder(directory, file) : [file];
      }))).flat();
    }
    const prepare = createNativeSitePreparation({
      resolveConnection: () => ({ target: { endpoint: 'https://storage.example.com', bucket: 'example-bucket', siteId: 'example-site' }, credentials: { accessKeyId: 'example-key', secretAccessKey: 'example-secret' } }),
      logger: { log: () => undefined }, environment: { NODE_ENV: 'test' },
      runCli: async ({ args }) => {
        expect(args.slice(0, 2)).toEqual(['s3', 'cp']);
        const files = await filesUnder(args[2]);
        if (!args.includes('--dryrun')) {
          attempted.push(files);
          for (const file of files) remote.set(file, await readFile(path.join(args[2], file)));
        }
        return files.map((file) => `(dryrun) upload: ${path.join(args[2], file)} to ${args[3]}${file}`).join('\n');
      },
    });
    const generatedArtifacts = Array.from({ length: 2072 }, (_, index) => createBuildArtifact({ path: `content/asset-${index}.svg`, content: Buffer.alloc(128, index % 256) }));
    async function plan(vaultPath: string) {
      const site = { siteId: 'example-site', vaultPath, bucketName: 'example-bucket' };
      return prepare({ site, registry: { sites: [site] }, generatedArtifacts, scope: { kind: 'assets', paths: generatedArtifacts.map((artifact) => artifact.path) },
        deleteRemoteFiles: false, verbose: false, stageTimer: passthroughStageTimer });
    }
    try {
      const vaultPath = path.join(root, 'vault');
      const cold = await plan(vaultPath);
      await cold.apply({ dryRun: true });
      expect(remote.size).toBe(0);
      await expect(readdir(vaultPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await cold.apply({ dryRun: false });
      await cold.close();
      expect(attempted.map((files) => files.length)).toEqual([2072]);
      const before = new Map(remote);
      const warm = await plan(vaultPath);
      await warm.apply({ dryRun: false });
      await warm.close();
      expect(attempted).toHaveLength(1);
      generatedArtifacts[0] = createBuildArtifact({ path: generatedArtifacts[0].path, content: Buffer.alloc(128, 255) });
      const edited = await plan(vaultPath);
      expect(edited.plan.fingerprint).not.toBe(warm.plan.fingerprint);
      await edited.apply({ dryRun: false });
      await edited.close();
      expect(attempted.map((files) => files.length)).toEqual([2072, 1]);
      expect([...remote].filter(([key, bytes]) => !before.get(key)?.equals(bytes)).map(([key]) => key)).toEqual(['content/asset-0.svg']);
      const migrated = path.join(root, 'another-machine');
      await cp(path.join(vaultPath, NOTOPRESS_DIR), path.join(migrated, NOTOPRESS_DIR), { recursive: true });
      const copied = await plan(migrated);
      await copied.apply({ dryRun: false });
      await copied.close();
      expect(attempted).toHaveLength(2);
      await rm(path.join(migrated, NOTOPRESS_DIR), { recursive: true });
      const missingCache = await plan(migrated);
      await missingCache.apply({ dryRun: false });
      await missingCache.close();
      expect(attempted.map((files) => files.length)).toEqual([2072, 1, 2072]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
