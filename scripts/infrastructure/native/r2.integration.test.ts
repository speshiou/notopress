import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, cp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  S3Client, CreateBucketCommand, DeleteBucketCommand, HeadBucketCommand,
  GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { z } from 'zod';
import type { Registry, Site } from '../../../src/domain/registry';
import { getRegistry } from '../config/registry';
import { buildSite } from '../../application/build-site';
import { runCommand } from '../../application/run-command';
import { createNativeSitePlan, createPublicationPlan } from '../../core/publishing/publication-plan';
import { assertOperationPlanFingerprint } from '../../core/publishing/operation-plan';
import { StorageManifestSchema } from '../../core/storage/manifest';
import type { RemoteStorage } from '../../core/storage/publication';
import { passthroughStageTimer } from '../../core/stage-timing';
import { computeContentHash } from '../../core/state/sync-state';
import { mapWithConcurrency } from '../../core/concurrency';
import { createNativeSitePreparation } from './storage';
import { createVaultStorageFiles } from './vault-inventory';
import { getStorageConnection } from './storage-config';
import { createS3RemoteStorage, type S3StorageRequests } from './s3-store';

const enabled = process.env.NOTOPRESS_R2_INTEGRATION === '1';
// An externally managed bucket must be newly created and empty. Its creator owns
// bucket deletion; this suite still removes and verifies all synthetic objects.
const externalBucket = process.env.NOTOPRESS_R2_TEST_MANAGED_BUCKET;
const bucketName = externalBucket || `notopress-integration-${randomUUID()}`;
const httpError = z.object({ $metadata: z.object({ httpStatusCode: z.number().optional() }).optional() });
const counts = { get: 0, head: 0, list: 0, put: 0, delete: 0 };

function httpStatus(error: unknown) {
  const parsed = httpError.safeParse(error);
  return parsed.success ? parsed.data.$metadata?.httpStatusCode : undefined;
}

function assertTestBucket(bucket: string | undefined) {
  if (bucket !== bucketName || !/^notopress-integration-[a-f0-9-]{36}$/.test(bucket)) {
    throw new Error('Integration request attempted to escape its disposable bucket.');
  }
}

function progress(message: string) { process.stdout.write(`[R2 integration] ${message}\n`); }

type Context = {
  client: S3Client;
  registry: Registry;
  site: Site;
  otherSite: Site;
  remote: RemoteStorage;
  fixtureRoot: string;
  absenceConfirmed: boolean;
  creationRequested: boolean;
};
let context: Context | undefined;
let restoreLogs: (() => void) | undefined;
let restoreFetch: (() => void) | undefined;

function getContext(): Context {
  if (!context) throw new Error('Disposable R2 test context unavailable.');
  return context;
}

function resetCounts() { counts.get = counts.head = counts.list = counts.put = counts.delete = 0; }

async function localSnapshot(vaultPath: string): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  async function walk(directory: string) {
    for (const entry of await readdir(path.join(vaultPath, directory), { withFileTypes: true })) {
      const relative = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(relative);
      else hashes[relative] = computeContentHash(await readFile(path.join(vaultPath, relative)));
    }
  }
  await walk('');
  return hashes;
}

async function remoteSnapshot(): Promise<Record<string, string>> {
  const { client } = getContext();
  assertTestBucket(bucketName);
  const page = await client.send(new ListObjectsV2Command({ Bucket: bucketName }), { abortSignal: AbortSignal.timeout(15_000) });
  if (page.IsTruncated) throw new Error('Synthetic fixture unexpectedly exceeded one listing page.');
  const hashes: Record<string, string> = {};
  for (const object of page.Contents || []) {
    if (!object.Key) throw new Error('Test object lacks a key.');
    const result = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: object.Key }), { abortSignal: AbortSignal.timeout(15_000) });
    if (!result.Body) throw new Error('Test object lacks a body.');
    hashes[object.Key] = computeContentHash(await result.Body.transformToByteArray());
  }
  return hashes;
}

async function prepare({ site = getContext().site, remote = getContext().remote, reconcile = false, recover = false, deleteRemoteFiles = false }: {
  site?: Site; remote?: RemoteStorage; reconcile?: boolean; recover?: boolean; deleteRemoteFiles?: boolean;
} = {}) {
  const c = getContext();
  assertTestBucket(site.bucketName);
  const registry: Registry = { ...c.registry, sites: [site] };
  const build = await buildSite({ site, registry, dryRun: true, prepareOnly: true, verbose: false, stageTimer: passthroughStageTimer });
  const preparation = createNativeSitePreparation({
    resolveConnection: getStorageConnection,
    connect: () => ({ remote, close: () => undefined }),
    createFiles: (vaultPath) => createVaultStorageFiles({ vaultPath }),
    newGeneration: randomUUID, logger: { log: () => undefined },
  });
  const storage = await preparation({
    site, registry, generatedArtifacts: build.generatedArtifacts, contentSnapshot: build.contentSnapshot,
    sourceArtifacts: build.sourceArtifacts, reconcile, recover, deleteRemoteFiles,
    verbose: false, stageTimer: passthroughStageTimer,
  });
  const nativeSitePlan = createNativeSitePlan({ contentSnapshot: build.contentSnapshot, rootIndex: build.vaultRootIndex, renderedArtifacts: build.renderedContent.artifacts, deleteRemoteFiles });
  const plan = createPublicationPlan({ nativeSitePlan, nativeStoragePlan: storage.plan, publications: [] });
  return { storage, plan };
}

async function cleanup() {
  const c = context;
  if (!c) { restoreLogs?.(); restoreFetch?.(); return; }
  assertTestBucket(bucketName);
  let cleaned = !c.creationRequested;
  try {
    if (c.absenceConfirmed && c.creationRequested) {
      try {
        await c.client.send(new HeadBucketCommand({ Bucket: bucketName }), { abortSignal: AbortSignal.timeout(15_000) });
      } catch (error: unknown) {
        if (httpStatus(error) === 404) cleaned = true;
        else throw new Error(`Test bucket cleanup inspection failed (HTTP ${httpStatus(error) ?? 'unknown'}).`);
      }
      if (!cleaned) {
        const page = await c.client.send(new ListObjectsV2Command({ Bucket: bucketName }), { abortSignal: AbortSignal.timeout(15_000) });
        if (page.IsTruncated) throw new Error('Refusing cleanup of an unexpectedly large disposable bucket.');
        await mapWithConcurrency({ items: page.Contents || [], concurrency: 4, worker: async (object) => {
          if (!object.Key) throw new Error('Cleanup object lacks a key.');
          await c.client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: object.Key }), { abortSignal: AbortSignal.timeout(15_000) });
        } });
        const remaining = await c.client.send(new ListObjectsV2Command({ Bucket: bucketName }), { abortSignal: AbortSignal.timeout(15_000) });
        if (remaining.Contents?.length || remaining.IsTruncated) throw new Error('Disposable bucket is not empty.');
        if (externalBucket) {
          cleaned = true;
          progress(`Cleanup confirmed: ${page.Contents?.length || 0} objects removed; empty disposable bucket awaits its creator's deletion.`);
          return;
        }
        await c.client.send(new DeleteBucketCommand({ Bucket: bucketName }), { abortSignal: AbortSignal.timeout(15_000) });
        try {
          await c.client.send(new HeadBucketCommand({ Bucket: bucketName }), { abortSignal: AbortSignal.timeout(15_000) });
          throw new Error('Disposable bucket still exists after cleanup.');
        } catch (error: unknown) {
          if (httpStatus(error) !== 404) throw new Error('Bucket deletion could not be confirmed.');
        }
        cleaned = true;
        progress(`Cleanup confirmed: ${page.Contents?.length || 0} objects removed; bucket deleted (404).`);
      }
    }
  } finally {
    c.client.destroy();
    restoreLogs?.();
    restoreFetch?.();
    if (cleaned) await rm(c.fixtureRoot, { recursive: true, force: true });
    else progress(`Cleanup needs attention for disposable bucket ${bucketName}; recovery ledger retained.`);
  }
}

describe.skipIf(!enabled).sequential('real R2 manifest workflow in a disposable bucket', () => {
  beforeAll(async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    restoreLogs = () => log.mockRestore();
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('Unexpected HTTP request; WordPress requests are forbidden in R2 integration tests.'); });
    restoreFetch = () => fetch.mockRestore();
    const original = await getRegistry();
    assertTestBucket(bucketName);
    if (original.sites.some((site) => site.bucketName === bucketName)) throw new Error('Disposable name collides with a configured bucket.');
    const endpoint = process.env.NOTOPRESS_R2_TEST_ENDPOINT || original.endpoint || process.env.S3_ENDPOINT || original.sites.find((site) => site.endpoint?.includes('.r2.cloudflarestorage.com'))?.endpoint;
    if (!endpoint || !new URL(endpoint).hostname.endsWith('.r2.cloudflarestorage.com')) throw new Error('An R2 endpoint is required for this integration suite.');
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'notopress-r2-integration-'));
    const site: Site = { siteId: 'integration-site', vaultPath: path.join(fixtureRoot, 'first-vault'), bucketName, endpoint, domain: 'example.invalid', thumbnailSizes: [8, 16], noteIncludePaths: ['_includes'] };
    const registry: Registry = { endpoint, accessKeyId: process.env.NOTOPRESS_R2_TEST_ACCESS_KEY_ID || original.accessKeyId || process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.NOTOPRESS_R2_TEST_SECRET_ACCESS_KEY || original.secretAccessKey || process.env.S3_SECRET_ACCESS_KEY, sites: [site] };
    const connection = getStorageConnection({ site, registry });
    const client = new S3Client({ endpoint: connection.target.endpoint, credentials: connection.credentials, region: 'auto', forcePathStyle: true, maxAttempts: 1, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
    const options = () => ({ abortSignal: AbortSignal.timeout(15_000) });
    const requests: S3StorageRequests = {
      get: (input) => { assertTestBucket(input.Bucket); counts.get++; return client.send(new GetObjectCommand(input), options()); },
      head: (input) => { assertTestBucket(input.Bucket); counts.head++; return client.send(new HeadObjectCommand(input), options()); },
      list: (input) => { assertTestBucket(input.Bucket); counts.list++; return client.send(new ListObjectsV2Command(input), options()); },
      put: (input) => { assertTestBucket(input.Bucket); counts.put++; return client.send(new PutObjectCommand(input), options()); },
      delete: (input) => { assertTestBucket(input.Bucket); counts.delete++; return client.send(new DeleteObjectCommand(input), options()); },
    };
    context = { client, site, registry, otherSite: { ...site, vaultPath: path.join(fixtureRoot, 'second-vault') }, remote: createS3RemoteStorage({ target: connection.target, requests }), fixtureRoot, absenceConfirmed: false, creationRequested: false };
    await writeFile(path.join(fixtureRoot, 'resource.json'), JSON.stringify({ bucketName, creationRequested: false }));
    if (externalBucket) {
      await client.send(new HeadBucketCommand({ Bucket: bucketName }), options());
      const initial = await client.send(new ListObjectsV2Command({ Bucket: bucketName }), options());
      if (initial.Contents?.length || initial.IsTruncated) throw new Error('Externally managed disposable bucket must be empty; refusing to use it.');
    } else try {
      await client.send(new HeadBucketCommand({ Bucket: bucketName }), options());
      throw new Error('Disposable bucket unexpectedly exists; refusing to use it.');
    } catch (error: unknown) {
      if (httpStatus(error) !== 404) throw new Error(`Disposable bucket preflight failed (HTTP ${httpStatus(error) ?? 'unknown'}). No configured bucket was accessed.`);
    }
    context.absenceConfirmed = true;
    context.creationRequested = true;
    await writeFile(path.join(fixtureRoot, 'resource.json'), JSON.stringify({ bucketName, creationRequested: true, absenceConfirmed: true }));
    try { if (!externalBucket) await client.send(new CreateBucketCommand({ Bucket: bucketName }), options()); }
    catch (error: unknown) { throw new Error(`Disposable bucket creation failed (HTTP ${httpStatus(error) ?? 'unknown'}). Test credentials need R2 bucket administration permissions.`); }
    progress(`${externalBucket ? 'Using newly created empty' : 'Created'} disposable bucket ${bucketName}.`);
    await mkdir(path.join(site.vaultPath, 'content'), { recursive: true });
    await mkdir(path.join(site.vaultPath, 'public'));
    await mkdir(path.join(site.vaultPath, '_includes'));
    await writeFile(path.join(site.vaultPath, 'content/article.md'), '---\ntitle: Example\ndate: 2026-01-01\nupdated: 2026-01-02\n---\n# Example\n\n![Example](hero.png)\n\n![[example-note]]\n');
    await writeFile(path.join(site.vaultPath, '_includes/example-note.md'), '# Example Note\n\nIncluded body.');
    await writeFile(path.join(site.vaultPath, 'public/example.txt'), 'AAAA');
    await writeFile(path.join(site.vaultPath, 'content/hero.png'), await sharp({ create: { width: 16, height: 16, channels: 3, background: '#808080' } }).png().toBuffer());
    await cp(site.vaultPath, context.otherSite.vaultPath, { recursive: true });
  }, 60_000);

  afterAll(cleanup, 120_000);

  it('keeps a real CLI dry run read-only', async () => {
    const c = getContext();
    const beforeLocal = await localSnapshot(c.site.vaultPath);
    const beforeRemote = await remoteSnapshot();
    await runCommand({ command: { kind: 'sync', siteId: c.site.siteId, dryRun: true, verbose: false, deleteRemoteFiles: false }, registry: c.registry, stageTimer: passthroughStageTimer });
    expect(await localSnapshot(c.site.vaultPath)).toEqual(beforeLocal);
    expect(await remoteSnapshot()).toEqual(beforeRemote);
    progress('PASS: actual command dry run made no local or remote changes.');
  }, 60_000);

  it('applies a reviewed composite fingerprint and independently verifies every uploaded object', async () => {
    const c = getContext();
    const preview = await prepare();
    await runCommand({ command: { kind: 'sync', siteId: c.site.siteId, dryRun: false, verbose: false, deleteRemoteFiles: false, expectedPlanFingerprint: preview.plan.fingerprint }, registry: c.registry, stageTimer: passthroughStageTimer });
    const state = await c.remote.readManifest();
    expect(StorageManifestSchema.parse(state?.body).status).toBe('ready');
    const hashes = await remoteSnapshot();
    for (const entry of StorageManifestSchema.parse(state?.body).entries) expect(hashes[entry.key]).toBe(entry.contentHash);
    progress(`PASS: reviewed bootstrap committed; ${Object.keys(hashes).length} actual R2 objects independently verified.`);
  }, 90_000);

  it('migrates to an empty local cache and performs no uploads or site listings when unchanged', async () => {
    const c = getContext();
    const before = await remoteSnapshot();
    resetCounts();
    const started = performance.now();
    const warm = await prepare();
    const cold = await prepare({ site: c.otherSite });
    expect(cold.plan.fingerprint).toBe(warm.plan.fingerprint);
    expect(counts.list).toBe(0);
    await cold.storage.apply({ dryRun: true });
    expect(counts.put).toBe(0);
    await cold.storage.apply({ dryRun: false });
    expect(counts.put).toBe(0);
    expect(counts.delete).toBe(0);
    expect(await remoteSnapshot()).toEqual(before);
    progress(`PASS: cold-machine migration and unchanged apply: zero writes and zero site listings (${((performance.now() - started) / 1000).toFixed(2)}s).`);
  }, 90_000);

  it('rejects an outdated composite fingerprint before writes and detects an equal-size edit', async () => {
    const c = getContext();
    const reviewed = await prepare();
    await writeFile(path.join(c.site.vaultPath, 'public/example.txt'), 'BBBB');
    const beforeRemote = await remoteSnapshot();
    const beforeLocal = await localSnapshot(c.site.vaultPath);
    await expect(runCommand({ command: { kind: 'sync', siteId: c.site.siteId, dryRun: false, verbose: false, deleteRemoteFiles: false, expectedPlanFingerprint: reviewed.plan.fingerprint }, registry: c.registry, stageTimer: passthroughStageTimer })).rejects.toThrow('publication plan changed');
    expect(await remoteSnapshot()).toEqual(beforeRemote);
    expect(await localSnapshot(c.site.vaultPath)).toEqual(beforeLocal);
    const changed = await prepare();
    const uploads = changed.storage.plan.operations.filter((operation) => operation.action === 'upload');
    expect(uploads).toHaveLength(1);
    assertOperationPlanFingerprint({ label: 'Integration', plan: changed.plan, expectedFingerprint: changed.plan.fingerprint });
    await changed.storage.apply({ dryRun: false });
    const after = await remoteSnapshot();
    expect(after['integration-site/public/example.txt']).toBe(computeContentHash('BBBB'));
    progress('PASS: stale fingerprint blocked all changes; equal-size edit uploaded exactly one object.');
  }, 90_000);

  it('allows only one concurrent publisher through actual R2 conditional writes', async () => {
    const c = getContext();
    await writeFile(path.join(c.site.vaultPath, 'public/example.txt'), 'CCCC');
    let release: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    let arrivals = 0;
    const racing: RemoteStorage = { ...c.remote, writeManifest: async (input) => {
      if (input.manifest.status === 'pending') {
        arrivals++;
        if (arrivals === 2) release?.();
        await barrier;
      }
      return c.remote.writeManifest(input);
    } };
    const first = await prepare({ remote: racing });
    const second = await prepare({ remote: racing });
    const results = await Promise.allSettled([first.storage.apply({ dryRun: false }), second.storage.apply({ dryRun: false })]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(arrivals).toBe(2);
    expect(StorageManifestSchema.parse((await c.remote.readManifest())?.body).status).toBe('ready');
    progress('PASS: actual R2 If-Match rejected one of two competing publishers.');
  }, 90_000);

  it('recovers from a failure injected after a confirmed real upload without replaying it', async () => {
    const c = getContext();
    await writeFile(path.join(c.site.vaultPath, 'public/example.txt'), 'DDDD');
    let uploaded = 0;
    const interrupted: RemoteStorage = { ...c.remote, upload: async (input) => {
      await c.remote.upload(input);
      uploaded++;
      throw new Error('Injected lost response after confirmed R2 upload.');
    } };
    const failed = await prepare({ remote: interrupted });
    await expect(failed.storage.apply({ dryRun: false })).rejects.toThrow('outcome is uncertain');
    expect(uploaded).toBe(1);
    expect(StorageManifestSchema.parse((await c.remote.readManifest())?.body).status).toBe('pending');
    await expect(prepare()).rejects.toThrow('pending or interrupted');
    const before = await remoteSnapshot();
    const recovery = await prepare({ reconcile: true, recover: true });
    expect(recovery.storage.plan.operations.filter((operation) => operation.action === 'upload')).toHaveLength(0);
    await recovery.storage.apply({ dryRun: true });
    expect(await remoteSnapshot()).toEqual(before);
    assertOperationPlanFingerprint({ label: 'Integration recovery', plan: recovery.plan, expectedFingerprint: recovery.plan.fingerprint });
    await recovery.storage.apply({ dryRun: false });
    expect(StorageManifestSchema.parse((await c.remote.readManifest())?.body).status).toBe('ready');
    progress('PASS: post-upload failure left pending state; read-only recovery preview and live reconciliation completed without replaying the upload.');
  }, 120_000);

  it('repairs external changes and missing objects only through explicit reconciliation', async () => {
    const c = getContext();
    await c.client.send(new PutObjectCommand({ Bucket: bucketName, Key: 'integration-site/public/example.txt', Body: 'XXXX' }), { abortSignal: AbortSignal.timeout(15_000) });
    await c.client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: 'integration-site/_rendered/content/article.html' }), { abortSignal: AbortSignal.timeout(15_000) });
    const repair = await prepare({ reconcile: true });
    expect(repair.storage.plan.operations.filter((operation) => operation.action === 'upload')).toHaveLength(2);
    await repair.storage.apply({ dryRun: false });
    const state = StorageManifestSchema.parse((await c.remote.readManifest())?.body);
    const hashes = await remoteSnapshot();
    for (const entry of state.entries) expect(hashes[entry.key]).toBe(entry.contentHash);
    progress('PASS: explicit reconciliation repaired actual external modification and deletion.');
  }, 120_000);

  it('preserves removed files by default and deletes them only with a reviewed opt-in plan', async () => {
    const c = getContext();
    await rm(path.join(c.site.vaultPath, 'public/example.txt'));
    const retained = await prepare();
    await retained.storage.apply({ dryRun: false });
    expect((await remoteSnapshot())['integration-site/public/example.txt']).toBe(computeContentHash('DDDD'));
    const before = await remoteSnapshot();
    const prune = await prepare({ deleteRemoteFiles: true });
    await prune.storage.apply({ dryRun: true });
    expect(await remoteSnapshot()).toEqual(before);
    expect(prune.storage.plan.operations.filter((operation) => operation.action === 'delete')).toHaveLength(1);
    await prune.storage.apply({ dryRun: false });
    expect((await remoteSnapshot())['integration-site/public/example.txt']).toBeUndefined();
    progress('PASS: deletion required explicit opt-in; deletion preview made no changes.');
  }, 120_000);
});
