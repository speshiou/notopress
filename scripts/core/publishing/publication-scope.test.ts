import { describe, expect, it } from 'vitest';
import { createOperationPlan } from './operation-plan';
import { formatPublicationScope } from './publication-scope';
import type { AwsStorageOperation } from '../storage/aws-cli-plan';

function plan(operations: AwsStorageOperation[] = []) {
  const allOperations: AwsStorageOperation[] = [
    { action: 'sync', target: { endpoint: 'https://storage.example.invalid', bucket: 'example-bucket', siteId: 'example-site' }, files: [], preview: [], deleteRemoteFiles: false },
    ...operations,
  ];
  return createOperationPlan({ kind: 'notopress-storage', operations: allOperations, serializeOperation: (operation) => operation });
}

describe('destination scope explanation', () => {
  it('distinguishes selected target posts from full-vault backup without interpreting folder names', () => {
    const storagePlan = plan();
    const fingerprint = storagePlan.fingerprint;
    const output = formatPublicationScope({ publisherId: 'example-main', targetSlugs: ['guides/article'], storagePlan, dryRun: true });
    expect(output).toContain('DRY RUN: proposed changes only');
    expect(output).toContain('Adapter selection: 1 requested source slug(s):\n  guides/article');
    expect(output).toContain('bucket example-bucket; site prefix example-site/');
    expect(output).toContain('Target-site publication via adapter: example-main');
    expect(output).toContain('all generated native-site outputs and distribution assets');
    expect(output).toContain('Source Markdown stays in Git. Storage uploads do not create adapter posts');
    const renamed = plan([{ action: 'upload-registry', size: 4, contentHash: 'hash' }]);
    expect(formatPublicationScope({ publisherId: 'example-main', targetSlugs: ['guides/article'], storagePlan: renamed, dryRun: true })).toBe(output);
    expect(storagePlan.fingerprint).toBe(fingerprint);
  });

  it('identifies native-only commands and does not imply adapter mutations', () => {
    const output = formatPublicationScope({ storagePlan: plan(), dryRun: false });
    expect(output).toContain('LIVE: planned changes before apply');
    expect(output).toContain('Target-site publication: none; no adapter posts are changed');
    expect(output).not.toContain('Adapter selection:');
  });

  it('identifies site-wide adapter selection when no slugs are supplied', () => {
    expect(formatPublicationScope({ publisherId: 'example-main', storagePlan: plan(), dryRun: true })).toContain('Adapter selection: site-wide changed documents');
  });

  it('identifies incremental distribution separately from full synchronization', () => {
    const operations: AwsStorageOperation[] = [{ action: 'upload-distribution', target: { endpoint: 'https://storage.example.com', bucket: 'example-bucket', siteId: 'example-site' }, files: [], preview: [] }];
    const storagePlan = createOperationPlan({ kind: 'notopress-storage-aws-cli', operations, serializeOperation: (operation) => operation });
    expect(formatPublicationScope({ storagePlan, dryRun: true })).toContain('Incremental distribution');
    expect(formatPublicationScope({ storagePlan, dryRun: true })).not.toContain('Full distribution sync');
  });
});
