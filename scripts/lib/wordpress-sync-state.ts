import { z } from 'zod';
import {
  loadSyncState,
  saveSyncState,
  VaultSyncState,
} from './sync-state';

export interface WordPressSyncEntry {
  contentHash: string;
  payloadHash?: string;
  remoteId?: number;
  remoteSlug?: string;
  contentType?: 'post' | 'page';
  syncedAt: string;
}

const WordPressSyncEntrySchema = z.object({
  contentHash: z.string(),
  payloadHash: z.string().optional(),
  remoteId: z.number().int().positive().optional(),
  remoteSlug: z.string().optional(),
  contentType: z.enum(['post', 'page']).optional(),
  syncedAt: z.string(),
});
const WordPressSyncMapSchema = z.record(z.string(), WordPressSyncEntrySchema);

export type WordPressSyncMap = Record<string, WordPressSyncEntry>;
export type WordPressSyncEntryInput = {
  contentHash: string;
  payloadHash?: string;
  remoteId?: number;
  remoteSlug?: string;
  contentType?: 'post' | 'page';
  syncedAt?: string;
};

/**
 * Safely extracts WordPress sync entries from a VaultSyncState object.
 */
export function getWordPressSyncStateFromObject(syncState: VaultSyncState): WordPressSyncMap {
  const result = WordPressSyncMapSchema.safeParse(syncState.wordpress || {});
  return result.success ? result.data : {};
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
 * Checks if a post slug is already synced with a matching publish payload hash.
 */
export async function isWordPressPayloadSynced({
  vaultPath,
  slug,
  payloadHash,
}: {
  vaultPath: string;
  slug: string;
  payloadHash: string;
}): Promise<boolean> {
  const entry = await getWordPressSyncEntry({ vaultPath, slug });
  return entry?.payloadHash === payloadHash;
}

/**
 * Mutates an in-memory VaultSyncState object to set a WordPress sync entry.
 * Initializes `syncState.wordpress` if it is missing.
 */
export function setWordPressEntry(
  syncState: VaultSyncState,
  slug: string,
  entry: WordPressSyncEntryInput
): WordPressSyncEntry {
  const syncEntry: WordPressSyncEntry = {
    contentHash: entry.contentHash,
    ...(entry.payloadHash ? { payloadHash: entry.payloadHash } : {}),
    ...(entry.remoteId ? { remoteId: entry.remoteId } : {}),
    ...(entry.remoteSlug ? { remoteSlug: entry.remoteSlug } : {}),
    ...(entry.contentType ? { contentType: entry.contentType } : {}),
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
  payloadHash,
  remoteId,
  remoteSlug,
  contentType,
  syncedAt,
}: {
  vaultPath: string;
  slug: string;
  contentHash: string;
  payloadHash?: string;
  remoteId?: number;
  remoteSlug?: string;
  contentType?: 'post' | 'page';
  syncedAt?: string;
}): Promise<VaultSyncState> {
  const syncState = await loadSyncState({ vaultPath });
  setWordPressEntry(syncState, slug, {
    contentHash,
    payloadHash,
    remoteId,
    remoteSlug,
    contentType,
    syncedAt,
  });
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
  entries: Record<string, WordPressSyncEntryInput>;
}): Promise<VaultSyncState> {
  const syncState = await loadSyncState({ vaultPath });
  for (const [slug, entry] of Object.entries(entries)) {
    setWordPressEntry(syncState, slug, entry);
  }
  await saveSyncState({ vaultPath, syncState });
  return syncState;
}
