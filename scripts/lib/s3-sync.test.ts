import { describe, expect, it } from 'vitest';
import { buildS3SyncArgs } from './s3-sync';

const BASE_INPUT = {
  vaultPath: 'vault',
  bucketName: 'content-bucket',
  siteId: 'example-site',
  endpoint: 'https://storage.example.com',
  dryRun: false,
  deleteRemoteFiles: false,
};

describe('buildS3SyncArgs', () => {
  it('does not delete remote files by default', () => {
    const args = buildS3SyncArgs(BASE_INPUT);

    expect(args).not.toContain('--delete');
  });

  it('adds deletion only when explicitly enabled', () => {
    const args = buildS3SyncArgs({ ...BASE_INPUT, deleteRemoteFiles: true });

    expect(args).toContain('--delete');
  });

  it('supports previewing deletion with AWS dry-run mode', () => {
    const args = buildS3SyncArgs({
      ...BASE_INPUT,
      deleteRemoteFiles: true,
      dryRun: true,
    });

    expect(args).toContain('--delete');
    expect(args).toContain('--dryrun');
  });
});
