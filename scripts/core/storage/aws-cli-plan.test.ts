import { describe, expect, it } from 'vitest';
import { createBuildArtifact } from '../content/build-artifact';
import { createAwsStoragePlan, normalizeAwsPreview } from './aws-cli-plan';

describe('AWS CLI storage fingerprints', () => {
  it('ignores temporary paths and ordering while fingerprinting bytes, destination, deletion policy, and CLI changes', () => {
    const first = normalizeAwsPreview({ output: '(dryrun) upload: first/article.md to s3://example-bucket/example-site/article.md\n(dryrun) delete: s3://example-bucket/example-site/old.md\n', snapshotPath: 'first' });
    const second = normalizeAwsPreview({ output: '(dryrun) delete: s3://example-bucket/example-site/old.md\r\n(dryrun) upload: second/article.md to s3://example-bucket/example-site/article.md\r\n', snapshotPath: 'second' });
    expect(first).toEqual(second);
    const target = { endpoint: 'https://storage.example.com', bucket: 'example-bucket', siteId: 'example-site' };
    const file = { ...createBuildArtifact({ path: 'article.md', content: 'body' }), key: 'example-site/article.md' };
    const registry = { ...createBuildArtifact({ path: 'registry.json', content: '{}' }), key: 'registry.json' };
    const input = { target, artifacts: [file, registry], preview: first, deleteRemoteFiles: false };
    const original = createAwsStoragePlan(input);
    expect(createAwsStoragePlan({ ...input, artifacts: [registry, file], preview: second }).fingerprint).toBe(original.fingerprint);
    for (const changed of [
      { ...input, deleteRemoteFiles: true }, { ...input, preview: [] },
      { ...input, target: { ...target, bucket: 'other-bucket' } },
      { ...input, artifacts: [{ ...file, contentHash: 'changed' }, registry] },
      { ...input, artifacts: [file, { ...registry, contentHash: 'changed' }] },
    ]) expect(createAwsStoragePlan(changed).fingerprint).not.toBe(original.fingerprint);
    expect(() => createAwsStoragePlan({ ...input, artifacts: [file] })).toThrow('registry artifact');
    const incremental = createAwsStoragePlan({ ...input, incremental: true });
    expect(incremental.fingerprint).not.toBe(original.fingerprint);
    expect(incremental.operations[0].action).toBe('upload-distribution');
    expect(() => createAwsStoragePlan({ ...input, incremental: true, deleteRemoteFiles: true })).toThrow('cannot delete');
  });
});

it('fingerprints adapter assets without a native registry and refuses deletion', () => {
  const target = { endpoint: 'https://storage.example.com', bucket: 'example-bucket', siteId: 'example-site' };
  const file = { ...createBuildArtifact({ path: 'content/diagram.svg', content: 'SVG' }), key: 'example-site/content/diagram.svg' };
  const input = { target, artifacts: [file], preview: [], deleteRemoteFiles: false, incremental: true, assetsOnly: true };
  const plan = createAwsStoragePlan(input);
  expect(plan.operations).toHaveLength(1);
  expect(plan.operations[0]).toMatchObject({ action: 'upload-distribution', assetsOnly: true });
  expect(createAwsStoragePlan({ ...input, artifacts: [{ ...file, contentHash: 'changed' }] }).fingerprint).not.toBe(plan.fingerprint);
  expect(() => createAwsStoragePlan({ ...input, incremental: false })).toThrow('without deletion or a native registry');
  expect(() => createAwsStoragePlan({ ...input, deleteRemoteFiles: true })).toThrow('without deletion or a native registry');
});
