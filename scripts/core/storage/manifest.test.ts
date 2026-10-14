import { describe, expect, it } from 'vitest';
import { StorageManifestSchema } from './manifest';

const entry = { key: 'example-site/article.md', size: 4, contentHash: 'a'.repeat(64), etag: 'etag' };
const manifest = {
  version: 1, target: { endpoint: 'https://storage.example.com', bucket: 'example-bucket', siteId: 'example-site' },
  generation: 'generation', status: 'ready', planFingerprint: null, entries: [entry],
};

describe('storage manifest schema', () => {
  it('accepts portable hash state and rejects versions, duplicates and cross-site keys', () => {
    expect(StorageManifestSchema.safeParse(manifest).success).toBe(true);
    for (const invalid of [
      { ...manifest, version: 2 },
      { ...manifest, entries: [entry, entry] },
      { ...manifest, entries: [{ ...entry, key: 'other-site/article.md' }] },
      { ...manifest, entries: [{ ...entry, contentHash: 'invalid' }] },
      { ...manifest, localPath: 'machine-specific' },
    ]) expect(StorageManifestSchema.safeParse(invalid).success).toBe(false);
  });
});
