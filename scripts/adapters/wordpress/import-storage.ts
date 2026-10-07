import path from 'node:path';
import type * as fs from 'node:fs/promises';

export function createWordPressImportStorage({ vaultPath, io, exists, hash, uniqueId }: {
  vaultPath: string;
  io: Pick<typeof fs, 'readFile' | 'writeFile' | 'mkdir' | 'rename' | 'link' | 'unlink' | 'realpath'>;
  exists: (file: string) => boolean;
  hash: (value: string | Buffer) => string;
  uniqueId: () => string;
}) {
  async function assertContained(file: string): Promise<void> {
    const root = await io.realpath(vaultPath);
    let parent = path.dirname(file);
    while (parent !== vaultPath && !exists(parent)) {
      const next = path.dirname(parent);
      if (parent === next) throw new Error('Import destination is outside the vault.');
      parent = next;
    }
    const resolved = await io.realpath(parent);
    const relative = path.relative(root, resolved);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Import destination resolves outside the vault.');
    }
    if (exists(file)) {
      const relativeFile = path.relative(root, await io.realpath(file));
      if (relativeFile === '..' || relativeFile.startsWith(`..${path.sep}`) || path.isAbsolute(relativeFile)) {
        throw new Error('Import destination resolves outside the vault.');
      }
    }
  }

  async function stage({ file, bytes }: { file: string; bytes: string | Buffer }): Promise<string> {
    await assertContained(file);
    await io.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${uniqueId()}.tmp`;
    await io.writeFile(temporary, bytes, { flag: 'wx' });
    return temporary;
  }

  async function getHash(file: string): Promise<string | null> {
    await assertContained(file);
    return exists(file) ? hash(await io.readFile(file)) : null;
  }

  async function writeAsset({ path: file, bytes }: { path: string; bytes: Buffer }): Promise<void> {
    if (await getHash(file) === hash(bytes)) return;
    const temporary = await stage({ file, bytes });
    try {
      // Hard-link installation is atomic and cannot overwrite an existing file.
      try { await io.link(temporary, file); }
      catch (error: unknown) {
        if (await getHash(file) !== hash(bytes)) throw error;
      }
    } finally { await io.unlink(temporary); }
  }

  async function commit({ articlePath, markdown, statePath, state, expectedStateHash, expectedArticleHash }: {
    articlePath: string;
    markdown: string;
    statePath: string;
    state: string;
    expectedStateHash: string | null;
    expectedArticleHash: string | null;
  }): Promise<void> {
    const articleBackup = exists(articlePath) ? await io.readFile(articlePath) : null;
    const articleTemp = await stage({ file: articlePath, bytes: markdown });
    let stateTemp: string | undefined;
    let articleCommitted = false;
    let stateCommitted = false;
    try {
      stateTemp = await stage({ file: statePath, bytes: state });
      if (await getHash(statePath) !== expectedStateHash || await getHash(articlePath) !== expectedArticleHash) {
        throw new Error('Vault content or sync state changed during import. Run the import again.');
      }
      await io.rename(articleTemp, articlePath);
      articleCommitted = true;
      await io.rename(stateTemp, statePath);
      stateCommitted = true;
    } catch (error: unknown) {
      if (articleCommitted && await getHash(articlePath) === hash(markdown)) {
        if (articleBackup) {
          const backupTemp = await stage({ file: articlePath, bytes: articleBackup });
          await io.rename(backupTemp, articlePath);
        } else await io.unlink(articlePath);
      }
      throw error;
    } finally {
      if (!articleCommitted) await io.unlink(articleTemp);
      if (stateTemp && !stateCommitted) await io.unlink(stateTemp);
    }
  }

  async function withLock<T>(action: () => Promise<T>): Promise<T> {
    const lock = path.join(vaultPath, '.notopress-wordpress-import.lock');
    await assertContained(lock);
    try { await io.writeFile(lock, '', { flag: 'wx' }); }
    catch { throw new Error('Another WordPress import holds the vault lock. If an import crashed, remove the stale .notopress-wordpress-import.lock before retrying.'); }
    try { return await action(); }
    finally { await io.unlink(lock); }
  }

  async function readAsset(file: string): Promise<Buffer> {
    await assertContained(file);
    return io.readFile(file);
  }

  return { getHash, writeAsset, commit, withLock, readAsset };
}
