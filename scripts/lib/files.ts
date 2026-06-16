import { access, readdir } from 'fs/promises';
import { constants } from 'fs';
import path from 'path';

export type FileEntry = {
  name: string;
  isDirectory: () => boolean;
  isFile: () => boolean;
};

export type FileScannerDeps = {
  access: (path: string, mode?: number) => Promise<void>;
  readdir: (path: string, options: { withFileTypes: true }) => Promise<FileEntry[]>;
  fileOkMode: number;
  joinPath: (...paths: string[]) => string;
  relativePath: (from: string, to: string) => string;
};

export function createFileScanner(deps: FileScannerDeps) {
  async function exists(filePath: string) {
    try {
      await deps.access(filePath, deps.fileOkMode);
      return true;
    } catch {
      return false;
    }
  }

  async function scanFiles({
    dir,
    baseDir = dir,
    shouldIncludeFile,
  }: {
    dir: string;
    baseDir?: string;
    shouldIncludeFile: (name: string) => boolean;
  }): Promise<string[]> {
    const files: string[] = [];

    async function walk(currentDir: string) {
      if (!(await exists(currentDir))) return;
      const entries = await deps.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = deps.joinPath(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (entry.name !== '.git' && entry.name !== 'node_modules') {
            await walk(fullPath);
          }
        } else if (entry.isFile() && shouldIncludeFile(entry.name)) {
          const relPath = deps.relativePath(baseDir, fullPath);
          files.push(relPath.replace(/\\/g, '/'));
        }
      }
    }

    await walk(dir);
    return files;
  }

  return {
    exists,
    scanPublicFiles({ dir, baseDir = dir }: { dir: string; baseDir?: string }) {
      return scanFiles({
        dir,
        baseDir,
        shouldIncludeFile: () => true,
      });
    },
    scanContentAssetFiles({ dir, baseDir = dir }: { dir: string; baseDir?: string }) {
      return scanFiles({
        dir,
        baseDir,
        shouldIncludeFile: (name) => !name.endsWith('.md') && !name.endsWith('.json'),
      });
    },
    async getAssetSubDir({
      vaultPath,
      filePath,
    }: {
      vaultPath: string;
      filePath: string;
    }): Promise<'public' | 'content'> {
      const publicPath = deps.joinPath(vaultPath, 'public', filePath);
      if (await exists(publicPath)) {
        return 'public';
      }
      return 'content';
    },
  };
}

const defaultFileScanner = createFileScanner({
  access,
  readdir,
  fileOkMode: constants.F_OK,
  joinPath: path.join,
  relativePath: path.relative,
});

export const exists = defaultFileScanner.exists;
export const scanPublicFiles = defaultFileScanner.scanPublicFiles;
export const scanContentAssetFiles = defaultFileScanner.scanContentAssetFiles;
export const getAssetSubDir = defaultFileScanner.getAssetSubDir;

