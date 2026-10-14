import { describe, expect, it } from 'vitest';
import { getStorageKey, isRelativeObjectPath, isPublishableVaultPath, isManagedStorageKey } from './paths';

describe('portable storage keys', () => {
  it.each(['/article.md', '../article.md', 'content/../article.md', 'content\\article.md', 'content//article.md', 'C:/article.md', 'content/./article.md'])('rejects %s', (path) => {
    expect(isRelativeObjectPath(path)).toBe(false);
    expect(() => getStorageKey({ siteId: 'example-site', path })).toThrow('Invalid storage');
  });
  it.each(['.git/config', 'content/.git/config', '.notopress/cache.json', 'public/.DS_Store'])('excludes internal file %s', (path) => {
    expect(isPublishableVaultPath(path)).toBe(false);
  });
  it('scopes object mutations to the selected site and shared registry', () => {
    expect(getStorageKey({ siteId: 'example-site', path: 'content/示例.md' })).toBe('example-site/content/示例.md');
    expect(isManagedStorageKey({ siteId: 'example-site', key: 'registry.json' })).toBe(true);
    expect(isManagedStorageKey({ siteId: 'example-site', key: 'example-site/content/article.md' })).toBe(true);
    expect(isManagedStorageKey({ siteId: 'example-site', key: 'other-site/content/article.md' })).toBe(false);
    expect(isManagedStorageKey({ siteId: 'example-site', key: 'example-site/.notopress/storage-manifest.json' })).toBe(false);
  });
});
