import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { Registry, Site } from '../../../src/domain/registry';
import { getRegistry } from '../config/registry';
import { runAwsCli } from './aws-cli';
import { getStorageConnection } from './storage-config';
import { prepareNativeSite } from './storage';
import { buildSite } from '../../application/build-site';
import { runCommand } from '../../application/run-command';
import { createNativeSitePlan, createPublicationPlan } from '../../core/publishing/publication-plan';
import { passthroughStageTimer } from '../../core/stage-timing';
import { computeContentHash } from '../../core/state/sync-state';

const enabled = process.env.NOTOPRESS_AWS_CLI_INTEGRATION === '1';
const bucket = process.env.NOTOPRESS_AWS_CLI_TEST_BUCKET || '';
const Listing = z.object({ IsTruncated: z.boolean().optional(), Contents: z.array(z.object({ Key: z.string(), ETag: z.string(), Size: z.number() })).optional() });
type Context = { root: string; site: Site; registry: Registry; environment: NodeJS.ProcessEnv; endpoint: string; emptyVerified: boolean };
let context: Context | undefined;

function ctx(): Context { if (!context) throw new Error('Disposable CLI test context unavailable.'); return context; }
function progress(message: string) { process.stdout.write(`[AWS CLI integration] ${message}\n`); }
function guard() { if (!/^notopress-cli-integration-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(bucket)) throw new Error('A newly created disposable CLI integration bucket is required.'); }
async function aws(args: string[]) {
  guard();
  return runAwsCli({ args: [...args, '--endpoint-url', ctx().endpoint], environment: ctx().environment });
}
async function remoteSnapshot() {
  const listed = Listing.parse(JSON.parse(await aws(['s3api', 'list-objects-v2', '--bucket', bucket, '--output', 'json'])));
  if (listed.IsTruncated) throw new Error('Disposable fixture unexpectedly exceeded one page.');
  return (listed.Contents || []).map(({ Key, ETag, Size }) => ({ Key, ETag, Size })).sort((a, b) => a.Key < b.Key ? -1 : a.Key > b.Key ? 1 : 0);
}
async function localSnapshot() {
  const hashes: Record<string, string> = {};
  async function walk(directory: string) {
    for (const entry of await readdir(path.join(ctx().site.vaultPath, directory), { withFileTypes: true })) {
      const file = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(file);
      else hashes[file] = computeContentHash(await readFile(path.join(ctx().site.vaultPath, file)));
    }
  }
  await walk('');
  return hashes;
}
async function prepare(deleteRemoteFiles = false) {
  const { site, registry } = ctx();
  const build = await buildSite({ site, registry, dryRun: true, prepareOnly: true, verbose: false, stageTimer: passthroughStageTimer });
  const storage = await prepareNativeSite({ site, registry, ...build, publicFiles: build.vaultRootIndex.publicFiles, deleteRemoteFiles, verbose: false, stageTimer: passthroughStageTimer });
  const nativeSitePlan = createNativeSitePlan({ contentSnapshot: build.contentSnapshot, rootIndex: build.vaultRootIndex, renderedArtifacts: build.renderedContent.artifacts, deleteRemoteFiles });
  const plan = createPublicationPlan({ nativeSitePlan, nativeStoragePlan: storage.plan, publications: [] });
  await storage.close();
  return { storagePlan: storage.plan, fingerprint: plan.fingerprint };
}

describe.skipIf(!enabled).sequential('AWS CLI workflow against disposable R2 storage', () => {
  beforeAll(async () => {
    guard();
    const original = await getRegistry();
    if (original.sites.some((site) => site.bucketName === bucket)) throw new Error('Refusing a configured bucket.');
    const endpoint = process.env.NOTOPRESS_R2_TEST_ENDPOINT || original.endpoint || process.env.S3_ENDPOINT;
    if (!endpoint || !new URL(endpoint).hostname.endsWith('.r2.cloudflarestorage.com')) throw new Error('An R2 test endpoint is required.');
    const root = await mkdtemp(path.join(tmpdir(), 'notopress-cli-live-'));
    const site: Site = { siteId: 'integration-site', bucketName: bucket, vaultPath: path.join(root, 'vault'), endpoint, domain: 'example.invalid', thumbnailSizes: [8] };
    const registry: Registry = { endpoint, sites: [site], accessKeyId: process.env.NOTOPRESS_R2_TEST_ACCESS_KEY_ID || original.accessKeyId || process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.NOTOPRESS_R2_TEST_SECRET_ACCESS_KEY || original.secretAccessKey || process.env.S3_SECRET_ACCESS_KEY };
    const connection = getStorageConnection({ site, registry });
    const configPath = path.join(root, 'aws-config');
    await writeFile(configPath, '[default]\nregion = auto\ns3 =\n    preferred_transfer_client = classic\n');
    context = { root, site, registry, endpoint: connection.target.endpoint, emptyVerified: false, environment: { ...process.env, AWS_ACCESS_KEY_ID: connection.credentials.accessKeyId, AWS_SECRET_ACCESS_KEY: connection.credentials.secretAccessKey, AWS_CONFIG_FILE: configPath, AWS_PROFILE: 'default', AWS_DEFAULT_PROFILE: 'default', AWS_DEFAULT_REGION: 'auto', AWS_MAX_ATTEMPTS: '1', AWS_RETRY_MODE: 'standard', AWS_PAGER: '', AWS_CLI_AUTO_PROMPT: 'off' } };
    if ((await remoteSnapshot()).length) throw new Error('Disposable bucket must be empty; refusing to use or clean it.');
    context.emptyVerified = true;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('WordPress/network fetch is forbidden in this storage test.'); });
    await mkdir(path.join(site.vaultPath, 'content'), { recursive: true });
    await mkdir(path.join(site.vaultPath, 'public'));
    await writeFile(path.join(site.vaultPath, 'content/article.md'), '---\ntitle: Example\ndate: 2026-01-01\nupdated: 2026-01-02\n---\n# Example\n\nbody\n');
    await writeFile(path.join(site.vaultPath, 'public/example.txt'), 'body');
  }, 30_000);

  afterAll(async () => {
    try {
      if (context?.emptyVerified) {
        await aws(['s3', 'rm', `s3://${bucket}/integration-site/`, '--recursive', '--only-show-errors']);
        await aws(['s3', 'rm', `s3://${bucket}/registry.json`, '--only-show-errors']);
        expect(await remoteSnapshot()).toEqual([]);
        progress('Cleanup verified: disposable bucket is empty; its creator can delete it.');
      }
    } finally {
      vi.restoreAllMocks();
      if (context) await rm(context.root, { recursive: true, force: true });
    }
  }, 60_000);

  it('validates real previews, reviewed apply, unchanged comparison, same-size edits, and opt-in deletion', async () => {
    const c = ctx();
    const command = { kind: 'sync', siteId: c.site.siteId, verbose: false, deleteRemoteFiles: false } as const;
    const local = await localSnapshot();
    await runCommand({ command: { ...command, dryRun: true }, registry: c.registry, stageTimer: passthroughStageTimer });
    expect(await localSnapshot()).toEqual(local);
    expect(await remoteSnapshot()).toEqual([]);
    progress('PASS: actual CLI dry run changed neither vault nor R2.');
    const first = await prepare();
    await runCommand({ command: { ...command, dryRun: false, expectedPlanFingerprint: first.fingerprint }, registry: c.registry, stageTimer: passthroughStageTimer });
    expect((await remoteSnapshot()).length).toBeGreaterThan(5);
    const warm = await prepare();
    expect(warm.storagePlan.operations.find((operation) => operation.action === 'sync')?.preview).toEqual([]);
    progress('PASS: reviewed apply uploaded real artifacts; unchanged vault had zero AWS CLI sync operations.');
    const source = path.join(c.site.vaultPath, 'content/article.md');
    await writeFile(source, (await readFile(source, 'utf8')).replace('body', 'EDIT'));
    const newer = new Date(Date.now() + 3000);
    await utimes(source, newer, newer);
    const beforeRemote = await remoteSnapshot();
    const beforeLocal = await localSnapshot();
    await expect(runCommand({ command: { ...command, dryRun: false, expectedPlanFingerprint: warm.fingerprint }, registry: c.registry, stageTimer: passthroughStageTimer })).rejects.toThrow('plan changed');
    expect(await remoteSnapshot()).toEqual(beforeRemote);
    expect(await localSnapshot()).toEqual(beforeLocal);
    const edited = await prepare();
    expect(edited.storagePlan.operations.find((operation) => operation.action === 'sync')?.preview.some((line) => line.includes('_rendered/content/article.html'))).toBe(true);
    await runCommand({ command: { ...command, dryRun: false, expectedPlanFingerprint: edited.fingerprint }, registry: c.registry, stageTimer: passthroughStageTimer });
    const downloaded = path.join(c.root, 'downloaded.md');
    await aws(['s3', 'cp', `s3://${bucket}/integration-site/_rendered/content/article.html`, downloaded, '--only-show-errors']);
    expect(await readFile(downloaded, 'utf8')).toContain('EDIT');
    progress('PASS: stale fingerprint blocked writes and standard CLI comparison uploaded the same-size edit.');
    await rm(path.join(c.site.vaultPath, 'public/example.txt'));
    const pruning = await prepare(true);
    const beforePrune = await remoteSnapshot();
    await runCommand({ command: { ...command, dryRun: true, deleteRemoteFiles: true }, registry: c.registry, stageTimer: passthroughStageTimer });
    expect(await remoteSnapshot()).toEqual(beforePrune);
    await runCommand({ command: { ...command, dryRun: false, deleteRemoteFiles: true, expectedPlanFingerprint: pruning.fingerprint }, registry: c.registry, stageTimer: passthroughStageTimer });
    expect((await remoteSnapshot()).some((entry) => entry.Key === 'integration-site/public/example.txt')).toBe(false);
    progress('PASS: deletion preview was read-only and reviewed --delete removed the synthetic file.');
  }, 180_000);
});
