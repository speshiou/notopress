import { describe, expect, it } from 'vitest';
import { indexStorageArtifacts, indexStorageEntries } from './validation';
import { artifact, target } from './publication.fixtures';

describe('shared storage inventory validation', () => {
  it('rejects duplicate, malformed, and out-of-scope remote entries and expected artifacts', () => {
    const entry = { key: `${target.siteId}/content/article.md`, size: 4, contentHash: null, etag: 'etag' };
    expect(indexStorageEntries({ target, entries: [entry] }).get(entry.key)).toEqual(entry);
    expect(() => indexStorageEntries({ target, entries: [entry, entry] })).toThrow('duplicate');
    expect(() => indexStorageEntries({ target, entries: [{ ...entry, key: 'other-site/article.md' }] })).toThrow('Invalid');
    expect(() => indexStorageEntries({ target, entries: [{ ...entry, etag: '' }] })).toThrow();
    const input = artifact();
    expect(() => indexStorageArtifacts({ target, artifacts: [input, input] })).toThrow('duplicate');
    expect(() => indexStorageArtifacts({ target, artifacts: [{ ...input, key: 'other-site/article.md' }] })).toThrow('Invalid');
  });
});
