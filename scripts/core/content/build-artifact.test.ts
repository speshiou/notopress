import { describe, expect, it } from 'vitest';
import { assertBuildSourceHashes, createBuildArtifact, readVerifiedArtifact } from './build-artifact';

describe('prepared build artifacts', () => {
  it('uses UTF-8 byte lengths and the same hash for text and binary inputs', async () => {
    const text = createBuildArtifact({ path: 'article.md', content: '示例' });
    const bytes = createBuildArtifact({ path: 'article.md', content: Buffer.from('示例') });
    expect(text.size).toBe(6);
    expect(text.contentHash).toBe(bytes.contentHash);
    expect(await readVerifiedArtifact(text)).toEqual(Buffer.from('示例'));
  });
  it('rejects same-sized changed bytes supplied by a lazy reader', async () => {
    const prepared = createBuildArtifact({ path: 'article.md', content: 'body', read: async () => Buffer.from('edit') });
    await expect(readVerifiedArtifact(prepared)).rejects.toThrow('Prepared artifact changed');
  });
});

it('rejects changed or missing build sources before applying a prepared plan', () => {
  const source = createBuildArtifact({ path: 'content/article.md', content: 'body' });
  const changed = createBuildArtifact({ path: source.path, content: 'edit' });
  expect(() => assertBuildSourceHashes({ artifacts: [changed], sources: [source] })).toThrow('Build source changed during preparation');
  expect(() => assertBuildSourceHashes({ artifacts: [], sources: [source] })).toThrow('Build source changed during preparation');
  expect(() => assertBuildSourceHashes({ artifacts: [source], sources: [source] })).not.toThrow();
});
