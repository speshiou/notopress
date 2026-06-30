import { describe, expect, it, vi } from 'vitest';
import path from 'path';
import { createIndexGenerator } from './indices';
import { type FileEntry } from './files';

function file(name: string): FileEntry {
  return { name, isDirectory: () => false, isFile: () => true };
}

function directory(name: string): FileEntry {
  return { name, isDirectory: () => true, isFile: () => false };
}

describe('createIndexGenerator', () => {
  it('generates directory indices, root index assets, and thumbnails through injected deps', async () => {
    const tree: Record<string, FileEntry[]> = {
      'vault/content': [file('page.md'), directory('blog'), file('hero.png')],
      'vault/content/blog': [file('post.md')],
    };
    const fileContent: Record<string, string> = {
      'vault/content/page.md': 'home',
      'vault/content/blog/post.md': 'post',
    };
    const writes: Record<string, string> = {};
    const generateImageThumbnails = vi.fn(async () => undefined);
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const generator = createIndexGenerator({
      exists: vi.fn(async (filePath: string) => filePath === 'vault/content' || filePath === 'vault/public'),
      mkdir: vi.fn(async () => undefined),
      readdir: vi.fn(async (filePath: string) => tree[filePath] || []),
      readFile: vi.fn(async (filePath: string) => fileContent[filePath] || ''),
      stat: vi.fn(async () => ({ mtime: new Date('2024-01-03T00:00:00.000Z') })),
      writeFile: vi.fn(async (filePath: string, content: string) => {
        writes[filePath] = content;
      }),
      joinPath: path.posix.join,
      relativePath: path.posix.relative,
      parseMatter: (content) =>
        content === 'home'
          ? { data: { title: 'Home', date: '2024-01-02' }, content: '# Home\nIntro text' }
          : { data: {}, content: '# Post\nPost excerpt' },
      normalizeThumbnailSizes: (sizes) => [...(sizes || [])],
      scanPublicFiles: vi.fn(async () => ['sitemap.xml', '_thumbnails/logo-320.webp']),
      scanContentAssetFiles: vi.fn(async () => ['hero.png', '_thumbnails/hero-320.webp']),
      generateImageThumbnails,
      logger,
    });

    const result = await generator.generateIndices({
      vaultPath: 'vault',
      thumbnailSizes: [320, 640],
      dryRun: false,
    });

    expect(result.rootContentIndex.pages[0].title).toBe('Home');
    expect(result.allIndices.get('blog')?.pages[0].slug).toBe('post');
    expect(JSON.parse(writes['vault/root.json'])).toMatchObject({
      directories: ['blog'],
      publicFiles: ['sitemap.xml'],
      assetFiles: ['hero.png', 'sitemap.xml'],
      thumbnailSizes: [320, 640],
    });
    expect(generateImageThumbnails).toHaveBeenCalledWith({
      sourceDir: 'vault/content',
      dryRun: false,
      thumbnailSizes: [320, 640],
      label: 'content',
    });
  });

  it('throws instead of exiting when content directory is missing', async () => {
    const generator = createIndexGenerator({
      exists: vi.fn(async () => false),
      mkdir: vi.fn(async () => undefined),
      readdir: vi.fn(async () => []),
      readFile: vi.fn(async () => ''),
      stat: vi.fn(async () => ({ mtime: new Date() })),
      writeFile: vi.fn(async () => undefined),
      joinPath: path.posix.join,
      relativePath: path.posix.relative,
      parseMatter: () => ({ data: {}, content: '' }),
      normalizeThumbnailSizes: (sizes) => [...(sizes || [])],
      scanPublicFiles: vi.fn(async () => []),
      scanContentAssetFiles: vi.fn(async () => []),
      generateImageThumbnails: vi.fn(async () => undefined),
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(generator.generateIndices({ vaultPath: 'vault', thumbnailSizes: [], dryRun: false })).rejects.toThrow(
      'content'
    );
  });

  it('strips code blocks when generating excerpt', async () => {
    const tree: Record<string, FileEntry[]> = {
      'vault/content': [file('page-with-code.md')],
    };
    const fileContent: Record<string, string> = {
      'vault/content/page-with-code.md': 'content',
    };
    const writes: Record<string, string> = {};

    const generator = createIndexGenerator({
      exists: vi.fn(async (filePath: string) => filePath === 'vault/content'),
      mkdir: vi.fn(async () => undefined),
      readdir: vi.fn(async (filePath: string) => tree[filePath] || []),
      readFile: vi.fn(async (filePath: string) => fileContent[filePath] || ''),
      stat: vi.fn(async () => ({ mtime: new Date('2024-01-03T00:00:00.000Z') })),
      writeFile: vi.fn(async (filePath: string, content: string) => {
        writes[filePath] = content;
      }),
      joinPath: path.posix.join,
      relativePath: path.posix.relative,
      parseMatter: () => ({
        data: { title: 'Code Page', date: '2024-01-02' },
        content: '# Code Page\n```typescript\nconst a = 1;\n```\nThis is the real first paragraph.',
      }),
      normalizeThumbnailSizes: (sizes) => [...(sizes || [])],
      scanPublicFiles: vi.fn(async () => []),
      scanContentAssetFiles: vi.fn(async () => []),
      generateImageThumbnails: vi.fn(async () => undefined),
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const result = await generator.generateIndices({
      vaultPath: 'vault',
      thumbnailSizes: [],
      dryRun: false,
    });

    expect(result.rootContentIndex.pages[0].excerpt).toBe('This is the real first paragraph.');
  });
});
