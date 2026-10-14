import { describe, expect, it, vi } from 'vitest';
import { assertOperationPlanFingerprint } from '../publishing/operation-plan';
import { createStoragePublisher } from './publication';
import { StorageManifestSchema } from './manifest';
import { target, artifact, createStorageHarness as harness } from './publication.fixtures';

describe('manifest storage publication', () => {
  it('checks transport size limits during planning before writing a reservation', async () => {
    const h = harness();
    const prepare = createStoragePublisher({ remote: { ...h.remote, maxUploadBytes: 1 }, newGeneration: () => 'generation', materialize: h.materialize, logger: { log: vi.fn() } });
    await expect(prepare({ target, artifacts: [artifact()], deleteRemoteFiles: false })).rejects.toThrow('transport size limit');
    expect(h.remote.writeManifest).not.toHaveBeenCalled();
  });
  it('bootstraps through read-only discovery and hashes actual bytes without trusting sizes or ETags', async () => {
    const h = harness();
    const expected = artifact();
    h.seed(expected);
    const plan = await h.prepare({ target, artifacts: [expected], deleteRemoteFiles: false });
    expect(h.remote.listObjects).toHaveBeenCalledOnce();
    expect(h.remote.hashObject).toHaveBeenCalledOnce();
    expect(plan.plan.operations).toContainEqual(expect.objectContaining({ action: 'skip', key: expected.key }));
    await plan.apply({ dryRun: true });
    expect(h.remote.writeManifest).not.toHaveBeenCalled();
    expect(h.remote.upload).not.toHaveBeenCalled();
    expect(h.remote.delete).not.toHaveBeenCalled();
    expect(h.materialize).not.toHaveBeenCalled();
    expect(h.getSnapshot()).toBeNull();
  });

  it('creates a remote manifest after successful bootstrap and skips listing from a fresh machine', async () => {
    const h = harness();
    const expected = artifact();
    const bootstrap = await h.prepare({ target, artifacts: [expected], deleteRemoteFiles: false });
    await bootstrap.apply({ dryRun: false });
    expect(h.remote.writeManifest.mock.calls.map(([input]) => input.manifest.status)).toEqual(['pending', 'ready']);
    const ready = StorageManifestSchema.parse(h.getSnapshot()?.body);
    expect(ready.entries[0].contentHash).toBe(expected.contentHash);
    const migrated = createStoragePublisher({ remote: h.remote, newGeneration: () => 'other-machine', materialize: h.materialize, logger: { log: vi.fn() } });
    h.remote.listObjects.mockClear();
    h.remote.upload.mockClear();
    h.remote.writeManifest.mockClear();
    const first = await h.prepare({ target, artifacts: [artifact()], deleteRemoteFiles: false });
    const second = await migrated({ target, artifacts: [artifact()], deleteRemoteFiles: false });
    expect(second.plan.fingerprint).toBe(first.plan.fingerprint);
    expect(h.remote.listObjects).not.toHaveBeenCalled();
    await second.apply({ dryRun: false });
    expect(h.remote.upload).not.toHaveBeenCalled();
    expect(h.remote.writeManifest).not.toHaveBeenCalled();
  });

  it('detects equal-size edits and includes remote identity and deletion policy in fingerprints', async () => {
    const h = harness();
    const original = artifact({ content: 'body' });
    h.seed(original);
    const entry = h.entryFor(original.key);
    if (!entry) throw new Error('Fixture missing');
    h.commitReady([entry]);
    const unchanged = await h.prepare({ target, artifacts: [original], deleteRemoteFiles: false });
    const changed = await h.prepare({ target, artifacts: [artifact({ content: 'edit' })], deleteRemoteFiles: false });
    expect(changed.plan.fingerprint).not.toBe(unchanged.plan.fingerprint);
    expect(changed.plan.operations).toContainEqual(expect.objectContaining({ action: 'upload', expectedEtag: 'original' }));
    expect(() => assertOperationPlanFingerprint({ label: 'Storage', plan: changed.plan, expectedFingerprint: unchanged.plan.fingerprint })).toThrow('plan changed');
    const deletion = await h.prepare({ target, artifacts: [], deleteRemoteFiles: true });
    const retain = await h.prepare({ target, artifacts: [], deleteRemoteFiles: false });
    expect(deletion.plan.fingerprint).not.toBe(retain.plan.fingerprint);
    expect(retain.plan.operations).toContainEqual({ action: 'retain', entry });
    await deletion.apply({ dryRun: true });
    expect(h.remote.delete).not.toHaveBeenCalled();
    await deletion.apply({ dryRun: false });
    expect(h.objects.has(original.key)).toBe(false);
  });

  it('changes the fingerprint when the destination changes and rejects mismatched manifests', async () => {
    const h = harness();
    const first = await h.prepare({ target, artifacts: [], deleteRemoteFiles: false });
    const second = await h.prepare({ target: { ...target, bucket: 'other-bucket' }, artifacts: [], deleteRemoteFiles: false });
    expect(second.plan.fingerprint).not.toBe(first.plan.fingerprint);
    h.commitReady();
    await expect(h.prepare({ target: { ...target, bucket: 'other-bucket' }, artifacts: [], deleteRemoteFiles: false })).rejects.toThrow('different destination');
  });

  it('rejects local drift and stale manifests before remote or local mutations', async () => {
    const h = harness();
    h.commitReady();
    let source = 'body';
    const expected = { ...artifact(), read: async () => Buffer.from(source) };
    const plan = await h.prepare({ target, artifacts: [expected], deleteRemoteFiles: false });
    source = 'edit';
    await expect(plan.apply({ dryRun: false })).rejects.toThrow('Prepared artifact changed');
    expect(h.remote.writeManifest).not.toHaveBeenCalled();
    source = 'body';
    h.commitReady();
    await expect(plan.apply({ dryRun: false })).rejects.toThrow('manifest changed after planning');
    expect(h.materialize).not.toHaveBeenCalled();
  });

  it('allows only one concurrent publisher to reserve the same manifest', async () => {
    const h = harness();
    h.commitReady();
    const args = { target, artifacts: [artifact()], deleteRemoteFiles: false };
    const first = await h.prepare(args);
    const second = await h.prepare(args);
    const outcomes = await Promise.allSettled([first.apply({ dryRun: false }), second.apply({ dryRun: false })]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    expect(h.remote.upload).toHaveBeenCalledOnce();
  });

  it('keeps failed and ambiguous writes pending and recovers through explicit reconciliation', async () => {
    const h = harness();
    h.commitReady();
    const expected = artifact();
    h.remote.upload.mockImplementationOnce(async ({ key, bytes }) => {
      h.objects.set(key, { bytes, etag: 'ambiguous-success' });
      throw new Error('Connection lost after server write');
    });
    const prepared = await h.prepare({ target, artifacts: [expected], deleteRemoteFiles: false });
    await expect(prepared.apply({ dryRun: false })).rejects.toThrow('outcome is uncertain');
    expect(StorageManifestSchema.parse(h.getSnapshot()?.body).status).toBe('pending');
    expect(h.remote.upload).toHaveBeenCalledOnce();
    await expect(h.prepare({ target, artifacts: [expected], deleteRemoteFiles: false })).rejects.toThrow('pending or interrupted');
    const recovery = await h.prepare({ target, artifacts: [expected], deleteRemoteFiles: false, reconcile: true, recover: true });
    expect(recovery.plan.operations).toContainEqual(expect.objectContaining({ action: 'skip', expectedEtag: 'ambiguous-success' }));
    await recovery.apply({ dryRun: true });
    expect(StorageManifestSchema.parse(h.getSnapshot()?.body).status).toBe('pending');
    await recovery.apply({ dryRun: false });
    expect(StorageManifestSchema.parse(h.getSnapshot()?.body).status).toBe('ready');
    expect(h.remote.upload).toHaveBeenCalledOnce();
  });

  it('reconciles external changes and missing objects rather than trusting old hashes', async () => {
    const h = harness();
    const expected = artifact();
    h.seed(expected);
    const entry = h.entryFor(expected.key);
    if (!entry) throw new Error('Fixture missing');
    h.commitReady([entry]);
    h.objects.set(expected.key, { bytes: Buffer.from('edit'), etag: 'external-change' });
    const repair = await h.prepare({ target, artifacts: [expected], deleteRemoteFiles: false, reconcile: true });
    expect(repair.plan.operations).toContainEqual(expect.objectContaining({ action: 'upload', expectedEtag: 'external-change' }));
    h.objects.delete(expected.key);
    const missing = await h.prepare({ target, artifacts: [expected], deleteRemoteFiles: false, reconcile: true });
    expect(missing.plan.operations).toContainEqual(expect.objectContaining({ action: 'upload', expectedEtag: null }));
  });

  it('fails closed on malformed state, unsafe keys and invalid recovery options', async () => {
    const h = harness();
    h.setSnapshot({ etag: 'invalid', body: { version: 99 } });
    await expect(h.prepare({ target, artifacts: [], deleteRemoteFiles: false })).rejects.toThrow('Invalid or unsupported');
    await expect(h.prepare({ target, artifacts: [], deleteRemoteFiles: false, recover: true })).rejects.toThrow('requires --reconcile-storage');
    h.setSnapshot(null);
    await expect(h.prepare({ target, artifacts: [{ ...artifact(), key: 'other-site/article.md' }], deleteRemoteFiles: false })).rejects.toThrow('Invalid or duplicate expected');
  });
});
