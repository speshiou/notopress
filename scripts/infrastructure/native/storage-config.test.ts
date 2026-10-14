import { describe, expect, it } from 'vitest';
import { getStorageConnection } from './storage-config';

const site = { siteId: 'example-site', vaultPath: 'vault', bucketName: 'example-bucket' };
const environment = { S3_ENDPOINT: 'https://storage.example.com/', S3_ACCESS_KEY_ID: 'example-key', S3_SECRET_ACCESS_KEY: 'example-secret' };

describe('portable storage configuration', () => {
  it('keeps local paths and credentials out of the fingerprinted target', () => {
    const connection = getStorageConnection({ site, registry: { sites: [site] }, environment });
    const migrated = getStorageConnection({ site: { ...site, vaultPath: 'other-vault' }, registry: { sites: [site] }, environment });
    expect(connection.target).toEqual({ endpoint: 'https://storage.example.com', bucket: 'example-bucket', siteId: 'example-site' });
    expect(migrated.target).toEqual(connection.target);
    expect(JSON.stringify(connection.target)).not.toContain('example-secret');
  });
  it('rejects endpoints that would expose credentials through plans', () => {
    expect(() => getStorageConnection({ site: { ...site, endpoint: 'https://example:secret@storage.example.com' }, registry: { sites: [site] }, environment })).toThrow('must not contain credentials');
  });
});
