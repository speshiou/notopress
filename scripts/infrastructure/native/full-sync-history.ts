import { createFullSyncHistory, FULL_SYNC_HISTORY_FILENAME } from '../../core/storage/full-sync-history';
import { createVaultStateFile, type VaultStateFilesystem } from './vault-state-file';

export function createVaultFullSyncHistory({ vaultPath, filesystem, now = () => new Date(), uniqueId }: {
  vaultPath: string;
  filesystem?: VaultStateFilesystem;
  now?: () => Date;
  uniqueId?: () => string;
}) {
  return createFullSyncHistory({ now, ...createVaultStateFile({ vaultPath, filename: FULL_SYNC_HISTORY_FILENAME, filesystem, uniqueId }) });
}
