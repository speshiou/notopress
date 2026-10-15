import { z } from 'zod';
import type { BuildArtifact } from '../../core/content/build-artifact';
import { computeContentHash } from '../../core/state/sync-state';
import type { StorageTarget } from '../../core/storage/target';
import { createVaultStateFile, type VaultStateFilesystem } from './vault-state-file';

const CacheSchema = z.object({ version: z.literal(1), hashes: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)) });
type UploadedFile = Pick<BuildArtifact, 'contentHash'> & { key: string };

/** Successful transfers only; missing or damaged local state requires another upload. */
export function createVaultUploadCache({ vaultPath, target, filesystem, uniqueId }: {
  vaultPath: string;
  target: StorageTarget;
  filesystem?: VaultStateFilesystem;
  uniqueId?: () => string;
}) {
  const scope = computeContentHash(JSON.stringify([target.endpoint, target.bucket, target.siteId]));
  const file = createVaultStateFile({ vaultPath, filename: `uploads-${scope}.json`, filesystem, uniqueId });
  async function load(): Promise<Record<string, string>> {
    try { return CacheSchema.parse(JSON.parse(await file.read())).hashes; }
    catch { return {}; }
  }
  return {
    load,
    async forget({ artifacts, replace = false }: { artifacts: readonly UploadedFile[]; replace?: boolean }) {
      const hashes = replace ? {} : await load();
      for (const artifact of artifacts) delete hashes[artifact.key];
      await file.write(JSON.stringify({ version: 1, hashes }));
    },
    async record({ artifacts, replace = false }: { artifacts: readonly UploadedFile[]; replace?: boolean }) {
      const hashes = replace ? {} : await load();
      for (const artifact of artifacts) hashes[artifact.key] = artifact.contentHash;
      await file.write(JSON.stringify({ version: 1, hashes }));
    },
  };
}
