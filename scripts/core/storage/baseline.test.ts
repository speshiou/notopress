import { describe, expect, it } from 'vitest';
import { createStorageBaselineInitializer, formatStorageBaselinePlan, parsePendingStorageKeys } from './baseline';
import { artifact, createStorageHarness, target } from './publication.fixtures';
import { StorageManifestSchema } from './manifest';

function setup() {
  const h = createStorageHarness();
  const prepare = createStorageBaselineInitializer({ remote: h.remote, newGeneration: () => 'generation' });
  return { ...h, prepareBaseline: prepare };
}

describe('trusted storage baseline initialization', () => {
  it('requires explicit trust and never overwrites existing ready, pending, or invalid state', async () => {
    const h = setup();
    await expect(h.prepareBaseline({ target, artifacts: [], trustLocal: false })).rejects.toThrow('--trust-local');
    expect(h.remote.readManifest).not.toHaveBeenCalled();
    h.commitReady();
    const ready = h.getSnapshot();
    for (const body of [ready?.body, { version: 1, status: 'pending' }, { version: 99 }]) {
      h.setSnapshot({ etag: 'existing', body });
      await expect(h.prepareBaseline({ target, artifacts: [], trustLocal: true })).rejects.toThrow('already exists');
    }
    expect(h.remote.listObjects).not.toHaveBeenCalled();
    expect(h.remote.writeManifest).not.toHaveBeenCalled();
  });

  it('uses metadata only, preserves known pending changes, and enables incremental sync from a new reader', async () => {
    const h = setup();
    const unchanged = artifact({ content: 'body' });
    const pending = artifact({ path: 'notes/pending.md', content: 'EDIT' });
    const differentSize = artifact({ path: 'notes/longer.md', content: 'longer body' });
    const missing = artifact({ path: 'notes/missing.md' });
    const remoteOnly = artifact({ path: 'notes/remote-only.md' });
    for (const input of [unchanged, pending, differentSize, remoteOnly]) h.seed(input);
    const artifacts = [unchanged, pending, differentSize, missing];
    const preview = await h.prepareBaseline({ target, artifacts, pendingKeys: [pending.key], trustLocal: true });
    expect(formatStorageBaselinePlan({ plan: preview.plan })).toContain('1 assumed synced, 3 pending, 1 remote-only retained');
    expect(formatStorageBaselinePlan({ plan: preview.plan })).toContain(`pending-upload: ${pending.key}`);
    expect(preview.plan.operations).toContainEqual(expect.objectContaining({ action: 'keep-pending', entry: expect.objectContaining({ key: pending.key, contentHash: null }) }));
    await preview.apply({ dryRun: true });
    expect(h.getSnapshot()).toBeNull();
    await expect(preview.apply({ dryRun: false })).rejects.toThrow('reviewed --expect');
    await expect(preview.apply({ dryRun: false, expectedFingerprint: '0'.repeat(64) })).rejects.toThrow('plan changed');
    expect(h.remote.writeManifest).not.toHaveBeenCalled();
    const second = await h.prepareBaseline({ target, artifacts: [...artifacts].map((input) => ({ ...input })), pendingKeys: [pending.key], trustLocal: true });
    expect(second.plan.fingerprint).toBe(preview.plan.fingerprint);
    await second.apply({ dryRun: false, expectedFingerprint: preview.plan.fingerprint });
    expect(h.remote.writeManifest).toHaveBeenCalledOnce();
    const manifest = StorageManifestSchema.parse(h.getSnapshot()?.body);
    expect(manifest.entries.find((entry) => entry.key === unchanged.key)?.contentHash).toBe(unchanged.contentHash);
    expect(manifest.entries.find((entry) => entry.key === differentSize.key)?.contentHash).toBeNull();
    expect(manifest.entries.some((entry) => entry.key === missing.key)).toBe(false);
    expect(manifest.entries.some((entry) => entry.key === remoteOnly.key)).toBe(true);
    expect(h.remote.hashObject).not.toHaveBeenCalled();
    expect(h.remote.upload).not.toHaveBeenCalled();
    expect(h.remote.delete).not.toHaveBeenCalled();
    expect(h.materialize).not.toHaveBeenCalled();
    h.remote.listObjects.mockClear();
    const incremental = await h.prepare({ target, artifacts, deleteRemoteFiles: false });
    expect(h.remote.listObjects).not.toHaveBeenCalled();
    expect(h.remote.hashObject).not.toHaveBeenCalled();
    expect(incremental.plan.operations.filter((operation) => operation.action === 'upload').map((operation) => 'key' in operation ? operation.key : '')).toEqual([differentSize.key, missing.key, pending.key]);
    await incremental.apply({ dryRun: false });
    expect(Buffer.from(h.objects.get(pending.key)?.bytes || []).toString()).toBe('EDIT');
  });

  it('explicitly assumes equal-size differences unless listed as pending', async () => {
    const h = setup();
    const edited = artifact({ content: 'EDIT' });
    h.seed(edited);
    const initialized = await h.prepareBaseline({ target, artifacts: [edited], trustLocal: true });
    await initialized.apply({ dryRun: false, expectedFingerprint: initialized.plan.fingerprint });
    const incremental = await h.prepare({ target, artifacts: [edited], deleteRemoteFiles: false });
    expect(incremental.plan.operations).toContainEqual(expect.objectContaining({ action: 'skip', key: edited.key }));
    expect(Buffer.from(h.objects.get(edited.key)?.bytes || []).toString()).toBe('body');
    expect(formatStorageBaselinePlan({ plan: initialized.plan })).toContain('Same-size differences not listed as pending will be assumed synced');
  });

  it('includes local hashes, remote identity, and pending selection in the reviewed fingerprint', async () => {
    const h = setup();
    const first = artifact();
    h.seed(first);
    const initial = await h.prepareBaseline({ target, artifacts: [first], trustLocal: true });
    const changed = await h.prepareBaseline({ target, artifacts: [artifact({ content: 'EDIT' })], trustLocal: true });
    const pending = await h.prepareBaseline({ target, artifacts: [first], pendingKeys: [first.key], trustLocal: true });
    expect(changed.plan.fingerprint).not.toBe(initial.plan.fingerprint);
    expect(pending.plan.fingerprint).not.toBe(initial.plan.fingerprint);
    h.objects.set(first.key, { bytes: Buffer.from('body'), etag: 'external' });
    const remoteChanged = await h.prepareBaseline({ target, artifacts: [first], trustLocal: true });
    expect(remoteChanged.plan.fingerprint).not.toBe(initial.plan.fingerprint);
    await expect(initial.apply({ dryRun: false, expectedFingerprint: initial.plan.fingerprint })).rejects.toThrow('Remote storage changed');
    expect(h.remote.writeManifest).not.toHaveBeenCalled();
  });

  it('rejects source drift, unknown pending keys, duplicates, and unsafe remote listings', async () => {
    const h = setup();
    const input = artifact();
    await expect(h.prepareBaseline({ target, artifacts: [input], pendingKeys: ['other-site/article.md'], trustLocal: true })).rejects.toThrow('not an expected');
    await expect(h.prepareBaseline({ target, artifacts: [input], pendingKeys: [input.key, input.key], trustLocal: true })).rejects.toThrow('Duplicate');
    await expect(h.prepareBaseline({ target, artifacts: [input, input], trustLocal: true })).rejects.toThrow('duplicate');
    const drifting = { ...input, read: async () => Buffer.from('EDIT') };
    const baseline = await h.prepareBaseline({ target, artifacts: [drifting], trustLocal: true });
    await expect(baseline.apply({ dryRun: false, expectedFingerprint: baseline.plan.fingerprint })).rejects.toThrow('Prepared artifact changed');
    h.objects.set('other-site/article.md', { bytes: Buffer.from('body'), etag: 'external' });
    await expect(h.prepareBaseline({ target, artifacts: [input], trustLocal: true })).rejects.toThrow('Invalid or duplicate');
    expect(h.remote.writeManifest).not.toHaveBeenCalled();
  });

  it('conditionally creates one manifest under competing initializers and does not retry uncertain writes', async () => {
    const h = setup();
    const first = await h.prepareBaseline({ target, artifacts: [], trustLocal: true });
    const second = await h.prepareBaseline({ target, artifacts: [], trustLocal: true });
    const results = await Promise.allSettled([first.apply({ dryRun: false, expectedFingerprint: first.plan.fingerprint }), second.apply({ dryRun: false, expectedFingerprint: second.plan.fingerprint })]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const failed = setup();
    const baseline = await failed.prepareBaseline({ target, artifacts: [], trustLocal: true });
    failed.remote.writeManifest.mockRejectedValueOnce(new Error('lost response'));
    await expect(baseline.apply({ dryRun: false, expectedFingerprint: baseline.plan.fingerprint })).rejects.toThrow('outcome is uncertain');
    expect(failed.remote.writeManifest).toHaveBeenCalledOnce();
  });

  it('parses exact pending keys without silently accepting malformed files', () => {
    expect(parsePendingStorageKeys('["example-site/content/article.md"]')).toEqual(['example-site/content/article.md']);
    for (const invalid of ['broken', '{}', '[1]', '["../article.md"]', '["key","key"]']) expect(() => parsePendingStorageKeys(invalid)).toThrow('JSON array');
  });
});
