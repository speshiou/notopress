import { vi } from 'vitest';
import { createBuildArtifact } from '../content/build-artifact';
import { computeContentHash } from '../state/sync-state';
import { createStoragePublisher, type ManifestRead, type RemoteStorage, type StorageArtifact } from './publication';
import type { StorageEntry, StorageManifest, StorageTarget } from './manifest';

export const target: StorageTarget = { endpoint: 'https://storage.example.com', bucket: 'example-bucket', siteId: 'example-site' };

export function artifact({ path = 'content/article.md', content = 'body' }: { path?: string; content?: string } = {}): StorageArtifact {
  return { ...createBuildArtifact({ path, content }), key: `${target.siteId}/${path}` };
}

export function createStorageHarness() {
  let snapshot: ManifestRead | null = null;
  let revision = 0;
  const objects = new Map<string, { bytes: Uint8Array; etag: string }>();
  const entryFor = (key: string): StorageEntry | null => {
    const object = objects.get(key);
    return object ? { key, size: object.bytes.byteLength, contentHash: computeContentHash(object.bytes), etag: object.etag } : null;
  };
  const remote = {
    readManifest: vi.fn(async () => snapshot ? structuredClone(snapshot) : null),
    listObjects: vi.fn(async () => [...objects.keys()].flatMap((key) => {
      const entry = entryFor(key);
      return entry ? [{ ...entry, contentHash: null }] : [];
    })),
    inspectObject: vi.fn(async (key: string) => entryFor(key)),
    hashObject: vi.fn(async (entry: StorageEntry) => {
      const current = entryFor(entry.key);
      if (!current || current.etag !== entry.etag) throw new Error('Remote object changed');
      return current;
    }),
    writeManifest: vi.fn(async ({ manifest, expectedEtag }: { manifest: StorageManifest; expectedEtag: string | null }) => {
      if ((snapshot?.etag || null) !== expectedEtag) throw new Error('Manifest precondition failed');
      const etag = `manifest-${++revision}`;
      snapshot = { etag, body: structuredClone(manifest) };
      return etag;
    }),
    upload: vi.fn(async ({ key, bytes, expectedEtag }: { key: string; bytes: Uint8Array; expectedEtag: string | null }) => {
      if ((objects.get(key)?.etag || null) !== expectedEtag) throw new Error('Upload precondition failed');
      const etag = `object-${++revision}`;
      objects.set(key, { bytes, etag });
      return etag;
    }),
    delete: vi.fn(async (entry: StorageEntry) => {
      if (objects.get(entry.key)?.etag !== entry.etag) throw new Error('Delete precondition failed');
      objects.delete(entry.key);
    }),
  } satisfies RemoteStorage;
  const materialize = vi.fn(async () => undefined);
  const prepare = createStoragePublisher({ remote, newGeneration: () => 'generation', materialize, logger: { log: vi.fn() } });
  const seed = (input: StorageArtifact) => { objects.set(input.key, { bytes: Buffer.from('body'), etag: 'original' }); };
  function commitReady(entries: StorageEntry[] = []) {
    snapshot = { etag: `manifest-${++revision}`, body: {
      version: 1, target, generation: 'original-generation', status: 'ready', planFingerprint: null, entries,
    } satisfies StorageManifest };
  }
  return { remote, prepare, materialize, objects, seed, entryFor, commitReady,
    getSnapshot: () => snapshot,
    setSnapshot: (value: ManifestRead | null) => { snapshot = value; },
  };
}
