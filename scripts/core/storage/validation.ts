import { StorageEntrySchema, type StorageEntry, type StorageTarget } from './manifest';
import { isManagedStorageKey } from './paths';
import type { BuildArtifact } from '../content/build-artifact';
import { compareStrings } from '../order';

export function sortStorageEntries(entries: Iterable<StorageEntry>): StorageEntry[] {
  return [...entries].sort((left, right) => compareStrings({ left: left.key, right: right.key }));
}

export function indexStorageEntries({ target, entries }: {
  target: StorageTarget;
  entries: readonly StorageEntry[];
}): Map<string, StorageEntry> {
  const indexed = new Map<string, StorageEntry>();
  for (const supplied of entries) {
    const entry = StorageEntrySchema.parse(supplied);
    if (!isManagedStorageKey({ siteId: target.siteId, key: entry.key }) || indexed.has(entry.key)) {
      throw new Error('Invalid or duplicate object in the storage inventory.');
    }
    indexed.set(entry.key, entry);
  }
  return indexed;
}

export function indexStorageArtifacts<T extends BuildArtifact & { key: string }>({ target, artifacts }: {
  target: StorageTarget;
  artifacts: readonly T[];
}): Map<string, T> {
  const indexed = new Map<string, T>();
  for (const artifact of artifacts) {
    if (!isManagedStorageKey({ siteId: target.siteId, key: artifact.key }) || indexed.has(artifact.key)) {
      throw new Error('Invalid or duplicate expected storage object.');
    }
    indexed.set(artifact.key, artifact);
  }
  return indexed;
}
