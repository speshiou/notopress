import { describe, expect, it, vi } from 'vitest';
import path from 'path';
import { createFileScanner, type FileEntry } from './files';

function file(name: string): FileEntry {
  return { name, isDirectory: () => false, isFile: () => true };
}

function directory(name: string): FileEntry {
  return { name, isDirectory: () => true, isFile: () => false };
}

describe('createFileScanner', () => {
  it('scans public files recursively while skipping ignored directories', async () => {
    const tree: Record<string, FileEntry[]> = {
      root: [file('logo.png'), directory('assets'), directory('node_modules')],
      'root/assets': [file('photo.jpg')],
      'root/node_modules': [file('ignored.js')],
    };

    const scanner = createFileScanner({
      access: vi.fn(async (filePath: string) => {
        if (!tree[filePath]) throw new Error('missing');
      }),
      readdir: vi.fn(async (filePath: string) => tree[filePath] || []),
      fileOkMode: 0,
      joinPath: path.posix.join,
      relativePath: path.posix.relative,
    });

    await expect(scanner.scanPublicFiles({ dir: 'root' })).resolves.toEqual(['logo.png', 'assets/photo.jpg']);
  });

  it('excludes markdown and json files from content assets', async () => {
    const tree: Record<string, FileEntry[]> = {
      content: [file('page.md'), file('data.json'), file('image.png')],
    };

    const scanner = createFileScanner({
      access: vi.fn(async (filePath: string) => {
        if (!tree[filePath]) throw new Error('missing');
      }),
      readdir: vi.fn(async (filePath: string) => tree[filePath] || []),
      fileOkMode: 0,
      joinPath: path.posix.join,
      relativePath: path.posix.relative,
    });

    await expect(scanner.scanContentAssetFiles({ dir: 'content' })).resolves.toEqual(['image.png']);
  });
});
