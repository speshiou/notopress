import { z } from 'zod';
import {
  loadSyncState,
  saveSyncState,
  VaultSyncState,
} from '../../core/state/sync-state';

export interface WordPressPublicationStateEntry {
  contentHash: string;
  payloadHash?: string;
  remoteId?: number;
  remoteSlug?: string;
  contentType?: 'post' | 'page';
  syncedAt: string;
}

const WordPressPublicationStateEntrySchema = z.object({
  contentHash: z.string(),
  payloadHash: z.string().optional(),
  remoteId: z.number().int().positive().optional(),
  remoteSlug: z.string().optional(),
  contentType: z.enum(['post', 'page']).optional(),
  syncedAt: z.string(),
});
const WordPressPublicationStateSchema = z.record(z.string(), WordPressPublicationStateEntrySchema);

export type WordPressPublicationState = Record<string, WordPressPublicationStateEntry>;
export type WordPressPublicationStateEntryInput = {
  contentHash: string;
  payloadHash?: string;
  remoteId?: number;
  remoteSlug?: string;
  contentType?: 'post' | 'page';
  syncedAt?: string;
};

/**
 * Safely extracts WordPress publication entries from a VaultSyncState object.
 */
export function getWordPressPublicationStateFromObject(syncState: VaultSyncState): WordPressPublicationState {
  const result = WordPressPublicationStateSchema.safeParse(syncState.wordpress || {});
  return result.success ? result.data : {};
}

/**
 * Reads WordPress publication entries directly from a vault path.
 */
export async function getWordPressPublicationState({
  vaultPath,
}: {
  vaultPath: string;
}): Promise<WordPressPublicationState> {
  const syncState = await loadSyncState({ vaultPath });
  return getWordPressPublicationStateFromObject(syncState);
}

/**
 * Reads a single WordPress publication entry for a given post slug.
 */
export async function getWordPressPublicationStateEntry({
  vaultPath,
  slug,
}: {
  vaultPath: string;
  slug: string;
}): Promise<WordPressPublicationStateEntry | undefined> {
  const publicationState = await getWordPressPublicationState({ vaultPath });
  return publicationState[slug];
}

/**
 * Checks whether a post slug has already published a matching payload hash.
 */
export async function isWordPressPayloadPublished({
  vaultPath,
  slug,
  payloadHash,
}: {
  vaultPath: string;
  slug: string;
  payloadHash: string;
}): Promise<boolean> {
  const entry = await getWordPressPublicationStateEntry({ vaultPath, slug });
  return entry?.payloadHash === payloadHash;
}

/**
 * Mutates an in-memory VaultSyncState object to set a WordPress publication entry.
 * Initializes `syncState.wordpress` if it is missing.
 */
export function setWordPressPublicationStateEntry(
  syncState: VaultSyncState,
  slug: string,
  entry: WordPressPublicationStateEntryInput
): WordPressPublicationStateEntry {
  const publicationEntry: WordPressPublicationStateEntry = {
    contentHash: entry.contentHash,
    ...(entry.payloadHash ? { payloadHash: entry.payloadHash } : {}),
    ...(entry.remoteId ? { remoteId: entry.remoteId } : {}),
    ...(entry.remoteSlug ? { remoteSlug: entry.remoteSlug } : {}),
    ...(entry.contentType ? { contentType: entry.contentType } : {}),
    syncedAt: entry.syncedAt ?? new Date().toISOString(),
  };
  syncState.wordpress = syncState.wordpress || {};
  syncState.wordpress[slug] = publicationEntry;
  return publicationEntry;
}

/**
 * Updates one WordPress publication entry in the vault's `.notopress-sync.json` file.
 */
export async function updateWordPressPublicationState({
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
  setWordPressPublicationStateEntry(syncState, slug, {
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
 * Updates multiple WordPress publication entries in the vault's `.notopress-sync.json` file.
 */
export async function updateWordPressPublicationStateEntries({
  vaultPath,
  entries,
}: {
  vaultPath: string;
  entries: Record<string, WordPressPublicationStateEntryInput>;
}): Promise<VaultSyncState> {
  const syncState = await loadSyncState({ vaultPath });
  for (const [slug, entry] of Object.entries(entries)) {
    setWordPressPublicationStateEntry(syncState, slug, entry);
  }
  await saveSyncState({ vaultPath, syncState });
  return syncState;
}
