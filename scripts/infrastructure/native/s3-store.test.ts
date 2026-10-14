import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { sdkStreamMixin } from '@smithy/util-stream';
import { S3Client, type GetObjectCommandOutput, type HeadObjectCommandOutput, type ListObjectsV2CommandOutput, type PutObjectCommandOutput } from '@aws-sdk/client-s3';
import { createS3RemoteStorage, connectS3Storage, type S3StorageRequests } from './s3-store';
import { target } from '../../core/storage/publication.fixtures';
import { computeContentHash } from '../../core/state/sync-state';
import type { StorageManifest } from '../../core/storage/manifest';

function body(content: string) { return sdkStreamMixin(Readable.from([Buffer.from(content)])); }
function requestsFixture() {
  const requests = {
    get: vi.fn(async (): Promise<GetObjectCommandOutput> => ({ $metadata: {}, ETag: 'etag', Body: body('body') })),
    head: vi.fn(async (): Promise<HeadObjectCommandOutput> => ({ $metadata: {}, ETag: 'etag', ContentLength: 4 })),
    list: vi.fn(async (): Promise<ListObjectsV2CommandOutput> => ({ $metadata: {}, IsTruncated: false, Contents: [] })),
    put: vi.fn(async (): Promise<PutObjectCommandOutput> => ({ $metadata: {}, ETag: 'written' })),
    delete: vi.fn(async () => ({ $metadata: {} })),
  } satisfies S3StorageRequests;
  return { requests, remote: createS3RemoteStorage({ target, requests }) };
}

describe('S3 manifest transport', () => {
  it('treats only missing keys as missing state and sanitizes provider errors', async () => {
    const { requests, remote } = requestsFixture();
    requests.get.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } });
    expect(await remote.readManifest()).toBeNull();
    requests.get.mockRejectedValueOnce(Object.assign(new Error('private-credential-value'), { $metadata: { httpStatusCode: 403 } }));
    await expect(remote.readManifest()).rejects.toThrow('HTTP 403');
    requests.list.mockRejectedValueOnce(new Error('private-credential-value'));
    await expect(remote.listObjects()).rejects.toThrow('Storage listing failed (HTTP unknown)');
  });

  it('scopes pagination to one site and excludes control objects and unrelated keys', async () => {
    const { requests, remote } = requestsFixture();
    requests.list.mockResolvedValueOnce({ $metadata: {}, IsTruncated: true, NextContinuationToken: 'next', Contents: [
      { Key: 'example-site/content/article.md', Size: 4, ETag: 'one' },
      { Key: 'example-site/.notopress/storage-manifest.json', Size: 4, ETag: 'control' },
      { Key: 'other-site/article.md', Size: 4, ETag: 'other' },
    ] });
    requests.list.mockResolvedValueOnce({ $metadata: {}, IsTruncated: false, Contents: [{ Key: 'example-site/public/hero.png', Size: 5, ETag: 'two' }] });
    expect((await remote.listObjects()).map((entry) => entry.key)).toEqual(['example-site/content/article.md', 'example-site/public/hero.png']);
    expect(requests.list.mock.calls).toEqual([
      [{ Bucket: target.bucket, Prefix: 'example-site/', MaxKeys: 1000, ContinuationToken: undefined }],
      [{ Bucket: target.bucket, Prefix: 'example-site/', MaxKeys: 1000, ContinuationToken: 'next' }],
    ]);
    requests.list.mockResolvedValue({ $metadata: {}, IsTruncated: true, NextContinuationToken: 'same' });
    await expect(remote.listObjects()).rejects.toThrow('continuation token');
  });

  it('uses conditional manifest writes and conditional uploads with content types', async () => {
    const { requests, remote } = requestsFixture();
    const manifest: StorageManifest = { version: 1, target, generation: 'generation', status: 'pending', planFingerprint: 'a'.repeat(64), entries: [] };
    await remote.writeManifest({ manifest, expectedEtag: null });
    expect(requests.put).toHaveBeenLastCalledWith(expect.objectContaining({ Key: 'example-site/.notopress/storage-manifest.json', IfNoneMatch: '*', CacheControl: 'no-store' }));
    await remote.writeManifest({ manifest: { ...manifest, status: 'ready' }, expectedEtag: 'reservation' });
    expect(requests.put).toHaveBeenLastCalledWith(expect.objectContaining({ IfMatch: 'reservation' }));
    await remote.upload({ key: 'example-site/_rendered/content/article.html', bytes: Buffer.from('html'), contentHash: computeContentHash('html'), expectedEtag: 'old-object' });
    expect(requests.put).toHaveBeenLastCalledWith(expect.objectContaining({ IfMatch: 'old-object', ContentType: 'text/html; charset=utf-8', ContentLength: 4 }));
  });

  it('hashes actual remote bytes under an ETag precondition', async () => {
    const { requests, remote } = requestsFixture();
    const entry = { key: 'example-site/article.md', size: 4, etag: 'etag', contentHash: null };
    expect(await remote.hashObject(entry)).toEqual({ ...entry, contentHash: computeContentHash('body') });
    expect(requests.get).toHaveBeenCalledWith({ Bucket: target.bucket, Key: entry.key, IfMatch: 'etag' });
  });

  it('rejects changed deletion targets and shared or out-of-scope deletes', async () => {
    const { requests, remote } = requestsFixture();
    const entry = { key: 'example-site/article.md', size: 4, etag: 'old', contentHash: null };
    await expect(remote.delete(entry)).rejects.toThrow('target changed');
    expect(requests.delete).not.toHaveBeenCalled();
    await expect(remote.delete({ ...entry, key: 'registry.json' })).rejects.toThrow('Shared bucket objects');
    await expect(remote.delete({ ...entry, key: 'other-site/article.md' })).rejects.toThrow('outside the managed');
    await remote.delete({ ...entry, etag: 'etag' });
    expect(requests.delete).toHaveBeenCalledExactlyOnceWith({ Bucket: target.bucket, Key: entry.key });
  });

  it('disables SDK retries, including ambiguous writes', async () => {
    let attempts: number | undefined;
    const send = vi.spyOn(S3Client.prototype, 'send').mockImplementation(async function(this: S3Client) {
      attempts = await this.config.maxAttempts();
      throw new Error('ambiguous-network-error');
    });
    const connection = connectS3Storage({ connection: { target, credentials: { accessKeyId: 'example-key', secretAccessKey: 'example-secret' } } });
    try {
      await expect(connection.remote.upload({ key: 'example-site/article.md', bytes: Buffer.from('body'), contentHash: computeContentHash('body'), expectedEtag: null })).rejects.toThrow('Storage write failed');
      expect(attempts).toBe(1);
      expect(send).toHaveBeenCalledOnce();
    } finally {
      connection.close();
      send.mockRestore();
    }
  });
});
