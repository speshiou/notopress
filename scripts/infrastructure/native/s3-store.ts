import {
  S3Client, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand,
  type GetObjectCommandInput, type GetObjectCommandOutput,
  type HeadObjectCommandInput, type HeadObjectCommandOutput,
  type ListObjectsV2CommandInput, type ListObjectsV2CommandOutput,
  type PutObjectCommandInput, type PutObjectCommandOutput,
  type DeleteObjectCommandInput, type DeleteObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { getContentType } from '../../../src/lib/content-types';
import type { RemoteStorage } from '../../core/storage/publication';
import type { StorageEntry, StorageTarget } from '../../core/storage/manifest';
import { getStorageKey, isManagedStorageKey, STORAGE_MANIFEST_PATH } from '../../core/storage/paths';
import { computeContentHash } from '../../core/state/sync-state';
import type { StorageConnection } from './storage-config';
import { hashByteStream } from './hash-stream';

export type S3StorageRequests = {
  get: (input: GetObjectCommandInput) => Promise<GetObjectCommandOutput>;
  head: (input: HeadObjectCommandInput) => Promise<HeadObjectCommandOutput>;
  list: (input: ListObjectsV2CommandInput) => Promise<ListObjectsV2CommandOutput>;
  put: (input: PutObjectCommandInput) => Promise<PutObjectCommandOutput>;
  delete: (input: DeleteObjectCommandInput) => Promise<DeleteObjectCommandOutput>;
};

const ErrorStatusSchema = z.object({ $metadata: z.object({ httpStatusCode: z.number().optional() }).optional() });

function statusCode(error: unknown): number | undefined {
  const parsed = ErrorStatusSchema.safeParse(error);
  return parsed.success ? parsed.data.$metadata?.httpStatusCode : undefined;
}

function requireEtag(etag: string | undefined): string {
  if (!etag) throw new Error('Storage response lacks an ETag. Refusing an unguarded operation.');
  return etag;
}

export function createS3RemoteStorage({ target, requests }: { target: StorageTarget; requests: S3StorageRequests }): RemoteStorage {
  async function safeRequest<T>({ operation, run }: { operation: string; run: () => Promise<T> }): Promise<T> {
    try {
      return await run();
    } catch (error: unknown) {
      const status = statusCode(error);
      throw Object.assign(new Error(`Storage ${operation} failed (HTTP ${status ?? 'unknown'}).`), {
        $metadata: { httpStatusCode: status },
      });
    }
  }
  const safeRequests: S3StorageRequests = {
    get: (input) => safeRequest({ operation: 'read', run: () => requests.get(input) }),
    head: (input) => safeRequest({ operation: 'inspection', run: () => requests.head(input) }),
    list: (input) => safeRequest({ operation: 'listing', run: () => requests.list(input) }),
    put: (input) => safeRequest({ operation: 'write', run: () => requests.put(input) }),
    delete: (input) => safeRequest({ operation: 'deletion', run: () => requests.delete(input) }),
  };
  const Bucket = target.bucket;
  const manifestKey = getStorageKey({ siteId: target.siteId, path: STORAGE_MANIFEST_PATH });
  function assertKey(key: string) {
    if (!isManagedStorageKey({ siteId: target.siteId, key })) throw new Error('Storage operation is outside the managed destination.');
  }
  async function readEntry(key: string): Promise<StorageEntry | null> {
    assertKey(key);
    try {
      const result = await safeRequests.head({ Bucket, Key: key });
      return { key, size: result.ContentLength ?? 0, etag: requireEtag(result.ETag), contentHash: null };
    } catch (error: unknown) {
      if (statusCode(error) === 404) return null;
      throw new Error(`Storage object inspection failed (HTTP ${statusCode(error) ?? 'unknown'}).`);
    }
  }
  return {
    maxUploadBytes: 5 * 1024 * 1024 * 1024,
    async readManifest() {
      try {
        const result = await safeRequests.get({ Bucket, Key: manifestKey });
        if (!result.Body) throw new Error('Storage manifest has no body.');
        const body = await result.Body.transformToString();
        let parsed: unknown;
        try { parsed = JSON.parse(body); } catch { parsed = null; }
        return { etag: requireEtag(result.ETag), body: parsed };
      } catch (error: unknown) {
        if (statusCode(error) === 404) return null;
        throw new Error(`Storage manifest read failed (HTTP ${statusCode(error) ?? 'unknown'}).`);
      }
    },
    async listObjects() {
      const entries: StorageEntry[] = [];
      let ContinuationToken: string | undefined;
      const tokens = new Set<string>();
      do {
        const page = await safeRequests.list({ Bucket, Prefix: `${target.siteId}/`, MaxKeys: 1000, ContinuationToken });
        for (const object of page.Contents || []) {
          if (!object.Key || !isManagedStorageKey({ siteId: target.siteId, key: object.Key })) continue;
          entries.push({ key: object.Key, size: object.Size ?? 0, etag: requireEtag(object.ETag), contentHash: null });
        }
        ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
        if (page.IsTruncated && (!ContinuationToken || tokens.has(ContinuationToken))) {
          throw new Error('Invalid storage listing continuation token.');
        }
        if (ContinuationToken) tokens.add(ContinuationToken);
      } while (ContinuationToken);
      return entries;
    },
    inspectObject: readEntry,
    async hashObject(entry) {
      assertKey(entry.key);
      const result = await safeRequests.get({ Bucket, Key: entry.key, IfMatch: entry.etag });
      if (!result.Body) throw new Error('Storage object has no body.');
      if (requireEtag(result.ETag) !== entry.etag) throw new Error('Remote object changed during reconciliation.');
      const hash = result.Body instanceof Readable
        ? await hashByteStream(result.Body)
        : await result.Body.transformToByteArray().then((bytes) => ({ size: bytes.byteLength, contentHash: computeContentHash(bytes) }));
      return { key: entry.key, ...hash, etag: requireEtag(result.ETag) };
    },
    async writeManifest({ manifest, expectedEtag }) {
      const result = await safeRequests.put({
        Bucket, Key: manifestKey, Body: JSON.stringify(manifest), ContentType: 'application/json', CacheControl: 'no-store',
        ...(expectedEtag ? { IfMatch: expectedEtag } : { IfNoneMatch: '*' }),
      });
      return requireEtag(result.ETag);
    },
    async upload({ key, bytes, contentHash, expectedEtag }) {
      assertKey(key);
      const result = await safeRequests.put({
        Bucket, Key: key, Body: bytes, ContentLength: bytes.byteLength,
        ContentType: getContentType(key), Metadata: { 'notopress-sha256': contentHash },
        ...(expectedEtag ? { IfMatch: expectedEtag } : { IfNoneMatch: '*' }),
      });
      return requireEtag(result.ETag);
    },
    async delete(entry) {
      assertKey(entry.key);
      if (!entry.key.startsWith(`${target.siteId}/`)) throw new Error('Shared bucket objects cannot be pruned.');
      // R2 does not document conditional deletes. Inspect under the site reservation and fail closed on drift.
      const current = await readEntry(entry.key);
      if (!current || current.etag !== entry.etag) throw new Error('Storage deletion target changed. Reconcile before deleting.');
      await safeRequests.delete({ Bucket, Key: entry.key });
    },
  };
}

export function connectS3Storage({ connection, region = 'auto' }: { connection: StorageConnection; region?: string }) {
  const client = new S3Client({
    endpoint: connection.target.endpoint, credentials: connection.credentials, region, forcePathStyle: true,
    maxAttempts: 1, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  });
  const options = () => ({ abortSignal: AbortSignal.timeout(30_000) });
  return {
    remote: createS3RemoteStorage({
      target: connection.target,
      requests: {
        get: (input) => client.send(new GetObjectCommand(input), options()),
        head: (input) => client.send(new HeadObjectCommand(input), options()),
        list: (input) => client.send(new ListObjectsV2Command(input), options()),
        put: (input) => client.send(new PutObjectCommand(input), options()),
        delete: (input) => client.send(new DeleteObjectCommand(input), options()),
      },
    }),
    close: () => client.destroy(),
  };
}
