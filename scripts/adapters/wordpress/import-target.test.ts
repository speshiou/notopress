import { describe, expect, it } from 'vitest';
import { createWordPressImportTargetResolver, getImportedImageMarkdownPath } from './import-target';

const site = { siteId: 'example', vaultPath: 'vault', rewrites: [{ source: 'guides/:group/:path*', destination: '/:path*' }] };
function resolve(files: string[]) {
  return createWordPressImportTargetResolver({ list: async () => files, join: (...parts) => parts.join('/'), exists: (file) => files.some((relative) => file === `vault/content/${relative}`) });
}
describe('WordPress import target', () => {
  it('uses document-relative image paths for content and public assets', () => {
    expect(getImportedImageMarkdownPath({ imagePath: 'assets/image.png', root: 'content', canonicalSlug: 'guides/edition-a/example-note' })).toBe('../../assets/image.png');
    expect(getImportedImageMarkdownPath({ imagePath: 'images/image.png', root: 'public', canonicalSlug: 'guides/edition-a/example-note' })).toBe('../../../public/images/image.png');
  });
  it('finds grouped articles from the unchanged remote slug without cached indexes', async () => {
    expect(await resolve(['guides/edition-a/example-note.md'])({ site, slugOrId: '10', wpSlug: 'example-note' })).toEqual({ localPath: 'vault/content/guides/edition-a/example-note.md', canonicalSlug: 'guides/edition-a/example-note', matchedExisting: true });
  });
  it('rejects ambiguous targets instead of overwriting a guessed article', async () => {
    await expect(resolve(['guides/edition-a/example-note.md', 'guides/edition-b/example-note.md'])({ site, slugOrId: 'example-note', wpSlug: 'example-note' })).rejects.toThrow('Ambiguous');
  });
  it('ignores generated documents and uses a root path for genuinely new imports', async () => {
    expect(await resolve(['_generated/example-note.md'])({ site, slugOrId: 'example-note', wpSlug: 'example-note' })).toEqual({ localPath: 'vault/content/example-note.md', canonicalSlug: 'example-note', matchedExisting: false });
  });
});
