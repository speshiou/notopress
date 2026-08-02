import {
  loadSyncState,
  saveSyncState,
  VaultSyncState,
  WordPressSyncEntry,
} from './sync-state';

export type { WordPressSyncEntry };

export type WordPressSyncMap = Record<string, WordPressSyncEntry>;

/**
 * Safely extracts WordPress sync entries from a VaultSyncState object.
 */
export function getWordPressSyncStateFromObject(syncState: VaultSyncState): WordPressSyncMap {
  return syncState.wordpress || {};
}

/**
 * Reads WordPress sync entries directly from a vault path.
 */
export async function getWordPressSyncState({
  vaultPath,
}: {
  vaultPath: string;
}): Promise<WordPressSyncMap> {
  const syncState = await loadSyncState({ vaultPath });
  return getWordPressSyncStateFromObject(syncState);
}

/**
 * Reads a single WordPress sync entry for a given post slug.
 */
export async function getWordPressSyncEntry({
  vaultPath,
  slug,
}: {
  vaultPath: string;
  slug: string;
}): Promise<WordPressSyncEntry | undefined> {
  const wpSyncState = await getWordPressSyncState({ vaultPath });
  return wpSyncState[slug];
}

/**
 * Checks if a post slug is already synced with matching content hash.
 */
export async function isWordPressContentSynced({
  vaultPath,
  slug,
  contentHash,
}: {
  vaultPath: string;
  slug: string;
  contentHash: string;
}): Promise<boolean> {
  const entry = await getWordPressSyncEntry({ vaultPath, slug });
  return entry?.contentHash === contentHash;
}

/**
 * Mutates an in-memory VaultSyncState object to set a WordPress sync entry.
 * Initializes `syncState.wordpress` if it is missing.
 */
export function setWordPressEntry(
  syncState: VaultSyncState,
  slug: string,
  entry: { contentHash: string; syncedAt?: string }
): WordPressSyncEntry {
  const syncEntry: WordPressSyncEntry = {
    contentHash: entry.contentHash,
    syncedAt: entry.syncedAt ?? new Date().toISOString(),
  };
  syncState.wordpress = syncState.wordpress || {};
  syncState.wordpress[slug] = syncEntry;
  return syncEntry;
}

/**
 * Updates a single WordPress post sync entry in the vault's `.notopress-sync.json` file.
 */
export async function updateWordPressSyncState({
  vaultPath,
  slug,
  contentHash,
  syncedAt,
}: {
  vaultPath: string;
  slug: string;
  contentHash: string;
  syncedAt?: string;
}): Promise<VaultSyncState> {
  const syncState = await loadSyncState({ vaultPath });
  setWordPressEntry(syncState, slug, { contentHash, syncedAt });
  await saveSyncState({ vaultPath, syncState });
  return syncState;
}

/**
 * Updates multiple WordPress post sync entries in batch in the vault's `.notopress-sync.json` file.
 */
export async function updateWordPressSyncEntries({
  vaultPath,
  entries,
}: {
  vaultPath: string;
  entries: Record<string, { contentHash: string; syncedAt?: string }>;
}): Promise<VaultSyncState> {
  const syncState = await loadSyncState({ vaultPath });
  for (const [slug, entry] of Object.entries(entries)) {
    setWordPressEntry(syncState, slug, entry);
  }
  await saveSyncState({ vaultPath, syncState });
  return syncState;
}
