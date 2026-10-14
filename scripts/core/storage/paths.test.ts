import { describe, expect, it } from 'vitest';
import { getStorageKey, isRelativeObjectPath, isPublishableVaultPath } from './paths';

describe('portable storage keys', () => {
  it.each(['/article.md', '../article.md', 'content/../article.md', 'content\\article.md', 'content//article.md', 'C:/article.md', 'content/./article.md'])('rejects %s', (path) => {
    expect(isRelativeObjectPath(path)).toBe(false);
    expect(() => getStorageKey({ siteId: 'example-site', path })).toThrow('Invalid storage');
  });
  it.each(['.git/config', 'content/.git/config', '.notopress/cache.json', 'public/.DS_Store'])('excludes internal file %s', (path) => {
    expect(isPublishableVaultPath(path)).toBe(false);
  });
  it('composes relative vault object keys', () => {
    expect(getStorageKey({ siteId: 'example-site', path: 'content/示例.md' })).toBe('example-site/content/示例.md');
  });
});
