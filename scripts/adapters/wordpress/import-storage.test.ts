import * as io from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createWordPressImportStorage } from './import-storage';

const directories: string[] = [];
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
afterEach(async () => { for (const dir of directories.splice(0)) await io.rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const vaultPath = await io.mkdtemp(path.join(os.tmpdir(), 'example-vault-'));
  directories.push(vaultPath);
  const storage = createWordPressImportStorage({ vaultPath, io, exists: existsSync, hash, uniqueId: randomUUID });
  return { storage, vaultPath };
}

describe('WordPress import storage', () => {
  it('installs an asset once and never replaces unrelated content', async () => {
    const { storage, vaultPath } = await fixture();
    const file = path.join(vaultPath, 'content', 'assets', 'image.png');
    await storage.writeAsset({ path: file, bytes: Buffer.from('original') });
    await storage.writeAsset({ path: file, bytes: Buffer.from('original') });
    await expect(storage.writeAsset({ path: file, bytes: Buffer.from('other') })).rejects.toThrow();
    expect(await io.readFile(file, 'utf-8')).toBe('original');
    expect(await io.readdir(path.dirname(file))).toEqual(['image.png']);
  });

  it('rolls back the article when committing sync state fails', async () => {
    const { vaultPath } = await fixture();
    const articlePath = path.join(vaultPath, 'example-note.md');
    const statePath = path.join(vaultPath, 'state.json');
    await io.writeFile(articlePath, 'original article');
    await io.writeFile(statePath, 'original state');
    const storage = createWordPressImportStorage({
      vaultPath, exists: existsSync, hash, uniqueId: randomUUID,
      io: { ...io, rename: async (from, to) => {
        if (to === statePath) throw new Error('State failure');
        return io.rename(from, to);
      } },
    });
    await expect(storage.commit({ articlePath, markdown: 'changed', statePath, state: 'changed state', expectedArticleHash: hash('original article'), expectedStateHash: hash('original state') })).rejects.toThrow('State failure');
    expect(await io.readFile(articlePath, 'utf-8')).toBe('original article');
    expect(await io.readFile(statePath, 'utf-8')).toBe('original state');
    expect((await io.readdir(vaultPath)).sort()).toEqual(['example-note.md', 'state.json']);
  });

  it('rejects symlink destinations outside the vault', async () => {
    const { storage, vaultPath } = await fixture();
    const outside = await io.mkdtemp(path.join(os.tmpdir(), 'example-outside-'));
    directories.push(outside);
    await io.symlink(outside, path.join(vaultPath, 'content'));
    await expect(storage.writeAsset({ path: path.join(vaultPath, 'content', 'image.png'), bytes: Buffer.from('original') })).rejects.toThrow('outside');
    expect(await io.readdir(outside)).toEqual([]);
  });

  it('prevents concurrent imports and releases the lock after failure', async () => {
    const { storage } = await fixture();
    await storage.withLock(async () => {
      await expect(storage.withLock(async () => undefined)).rejects.toThrow('vault lock');
    });
    await expect(storage.withLock(async () => { throw new Error('failed'); })).rejects.toThrow('failed');
    await expect(storage.withLock(async () => 'done')).resolves.toBe('done');
  });
});
