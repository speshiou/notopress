import { describe, expect, it } from 'vitest';
import { assertBuildSourceHashes, createTrackedSourceReader, createBuildArtifact, type BuildArtifact, readVerifiedArtifact } from './build-artifact';

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

it('tracks included source bytes and detects a changed lazy source on verification', async () => {
  let content = Buffer.from('Included body');
  const artifacts: BuildArtifact[] = [];
  const read = createTrackedSourceReader({ vaultPath: 'vault', read: async () => content,
    relativePath: () => '_includes/example-note.md', collectArtifact: (artifact) => { artifacts.push(artifact); },
  });
  expect(await read('vault/_includes/example-note.md')).toBe('Included body');
  expect(artifacts[0].path).toBe('_includes/example-note.md');
  content = Buffer.from('Changed body');
  await expect(readVerifiedArtifact(artifacts[0])).rejects.toThrow('Prepared artifact changed');
});
