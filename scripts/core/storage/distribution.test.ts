import { describe, expect, it } from 'vitest';
import { createBuildArtifact, type BuildArtifact } from '../content/build-artifact';
import { selectDistributionArtifacts } from './distribution';

function article(sourceSlug: string, assets: string[]): BuildArtifact {
  return { ...createBuildArtifact({ path: `_rendered/content/${sourceSlug}.html`, content: sourceSlug }), distribution: { sourceSlug, noteSlugs: [sourceSlug], assets } };
}
const artifacts = [article('article', ['content/_thumbnails/hero-8.webp']), article('unrelated-new', ['content/other.svg']),
  ...['root.json', 'content/index.json', 'public/sitemap.xml', 'content/_thumbnails/hero-8.webp', 'AGENTS.md'].map((path) => createBuildArtifact({ path, content: '{}' })),
];

describe('source-independent distribution selection', () => {
  it.each(['full', 'incremental'] as const)('keeps all advertised native HTML and public assets together for %s transfers', (kind) => {
    const selected = selectDistributionArtifacts({ generatedArtifacts: artifacts, scope: { kind }, publicFiles: ['download.pdf', 'source.md'] });
    expect(selected.generated.map((artifact) => artifact.path)).toContain('_rendered/content/unrelated-new.html');
    expect(selected.generated.map((artifact) => artifact.path)).toContain('content/index.json');
    expect(selected.generated.map((artifact) => artifact.path)).not.toContain('AGENTS.md');
    expect(selected.assets).toContain('public/download.pdf');
    expect(selected.assets).not.toContain('public/source.md');
  });
  it('uses adapter-declared assets without native HTML, indexes, sitemaps or unrelated files', () => {
    const selected = selectDistributionArtifacts({ generatedArtifacts: artifacts, scope: { kind: 'assets', paths: ['content/_thumbnails/hero-8.webp', 'content/diagram.svg'] }, publicFiles: ['unrelated.pdf'] });
    expect(selected.generated.map((artifact) => artifact.path)).toEqual(['content/_thumbnails/hero-8.webp']);
    expect(selected.assets).toEqual(['content/_thumbnails/hero-8.webp', 'content/diagram.svg']);
  });
  it.each(['AGENTS.md', '../private.png', '.notopress/state.json'])('rejects invalid adapter asset %s', (asset) => {
    expect(() => selectDistributionArtifacts({ generatedArtifacts: artifacts, scope: { kind: 'assets', paths: [asset] }, publicFiles: [] })).toThrow('Invalid distribution asset');
  });
  it('rejects incomplete native dependency metadata', () => {
    expect(() => selectDistributionArtifacts({ generatedArtifacts: [createBuildArtifact({ path: '_rendered/content/article.html', content: 'body' })], scope: { kind: 'full' }, publicFiles: [] })).toThrow('dependency metadata');
  });
});
