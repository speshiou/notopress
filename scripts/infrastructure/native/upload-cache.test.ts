import { describe, expect, it } from 'vitest';
import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createVaultUploadCache } from './upload-cache';
import { NOTOPRESS_DIR } from '../../../src/lib/constants';
import { computeContentHash } from '../../core/state/sync-state';

const target = { endpoint: 'https://storage.example.com', bucket: 'example-bucket', siteId: 'example-site' };
const first = { key: 'example-site/content/image.svg', contentHash: computeContentHash('first') };

describe('successful upload cache', () => {
  it('reads without writes, scopes by destination, survives copying, and replaces full-sync records', async () => {
    const vaultPath = await mkdtemp(path.join(tmpdir(), 'notopress-upload-cache-'));
    try {
      const cache = createVaultUploadCache({ vaultPath, target });
      expect(await cache.load()).toEqual({});
      expect(await readdir(vaultPath)).toEqual([]);
      await cache.record({ artifacts: [first] });
      expect(await createVaultUploadCache({ vaultPath, target }).load()).toEqual({ [first.key]: first.contentHash });
      const copiedVault = path.join(vaultPath, 'copied');
      await cp(path.join(vaultPath, NOTOPRESS_DIR), path.join(copiedVault, NOTOPRESS_DIR), { recursive: true });
      expect(await createVaultUploadCache({ vaultPath: copiedVault, target }).load()).toEqual({ [first.key]: first.contentHash });
      for (const changed of [{ ...target, bucket: 'another-bucket' }, { ...target, endpoint: 'https://other.example.com' }, { ...target, siteId: 'another-site' }]) {
        expect(await createVaultUploadCache({ vaultPath, target: changed }).load()).toEqual({});
      }
      const second = { key: 'example-site/content/other.svg', contentHash: computeContentHash('second') };
      await cache.record({ artifacts: [second] });
      expect(await cache.load()).toEqual({ [first.key]: first.contentHash, [second.key]: second.contentHash });
      await cache.forget({ artifacts: [first] });
      expect(await cache.load()).toEqual({ [second.key]: second.contentHash });
      await cache.record({ artifacts: [first] });
      await cache.record({ artifacts: [second], replace: true });
      expect(await cache.load()).toEqual({ [second.key]: second.contentHash });
      const [filename] = await readdir(path.join(vaultPath, NOTOPRESS_DIR));
      await writeFile(path.join(vaultPath, NOTOPRESS_DIR, filename), 'incomplete');
      expect(await cache.load()).toEqual({});
    } finally { await rm(vaultPath, { recursive: true, force: true }); }
  });
});
