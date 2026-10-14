import { describe, expect, it } from 'vitest';
import { buildS3SyncArgs } from './s3-sync';

describe('mature AWS CLI synchronization', () => {
  it('previews the selected prefix and uses standard comparison with explicit deletion opt-in', () => {
    const input = { vaultPath: 'prepared vault', target: { endpoint: 'https://storage.example.com', bucket: 'example-bucket', siteId: 'example-site' }, dryRun: true, deleteRemoteFiles: false };
    const preview = buildS3SyncArgs(input);
    expect(preview.slice(0, 4)).toEqual(['s3', 'sync', 'prepared vault/', 's3://example-bucket/example-site/']);
    expect(preview).toContain('--dryrun');
    expect(preview).toContain('--no-follow-symlinks');
    expect(preview).not.toContain('--size-only');
    expect(preview).not.toContain('--delete');
    expect(preview).toContain('.notopress/*');
    const live = buildS3SyncArgs({ ...input, dryRun: false, deleteRemoteFiles: true });
    expect(live).toContain('--delete');
    expect(live).not.toContain('--dryrun');
  });
});
