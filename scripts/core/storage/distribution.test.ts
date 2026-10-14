import { describe, expect, it } from 'vitest';
import { createBuildArtifact, type BuildArtifact } from '../content/build-artifact';
import { selectDistributionArtifacts } from './distribution';

function article(sourceSlug: string, notes: string[], assets: string[]): BuildArtifact {
  return { ...createBuildArtifact({ path: `_rendered/content/${sourceSlug}.html`, content: sourceSlug }), distribution: { sourceSlug, noteSlugs: [sourceSlug, ...notes], assets } };
}
const artifacts = [article('article', [], ['content/_thumbnails/hero-8.webp']), article('dependent', ['article'], ['content/diagram.svg']), article('unrelated', [], ['content/other.svg']),
  ...['root.json', 'content/index.json', 'public/sitemap.xml', 'content/_thumbnails/hero-8.webp', 'content/_thumbnails/unused-8.webp', 'AGENTS.md'].map((path) => createBuildArtifact({ path, content: '{}' })),
];

describe('source-independent distribution selection', () => {
  it('selects targets, reverse note dependencies, shared outputs and used thumbnails', () => {
    const selected = selectDistributionArtifacts({ generatedArtifacts: artifacts, scope: { kind: 'incremental', targetSlugs: ['article'] }, publicFiles: ['unrelated.txt'] });
    expect(selected.generated.map((artifact) => artifact.path)).toEqual(['_rendered/content/article.html', '_rendered/content/dependent.html', 'root.json', 'content/index.json', 'public/sitemap.xml', 'content/_thumbnails/hero-8.webp']);
    expect(selected.assets).toEqual(['content/_thumbnails/hero-8.webp', 'content/diagram.svg']);
  });
  it('preserves full HTML and thumbnail coverage while excluding source Markdown and agent rules', () => {
    const selected = selectDistributionArtifacts({ generatedArtifacts: artifacts, scope: { kind: 'full' }, publicFiles: ['download.pdf', 'source.md'] });
    expect(selected.generated).toContain(artifacts[2]);
    expect(selected.generated.map((artifact) => artifact.path)).toContain('content/_thumbnails/unused-8.webp');
    expect(selected.generated.map((artifact) => artifact.path)).not.toContain('AGENTS.md');
    expect(selected.assets).toContain('public/download.pdf');
    expect(selected.assets).not.toContain('public/source.md');
  });
  it('rejects unknown targets and incomplete dependency metadata', () => {
    expect(() => selectDistributionArtifacts({ generatedArtifacts: artifacts, scope: { kind: 'incremental', targetSlugs: ['missing'] }, publicFiles: [] })).toThrow('Missing rendered publication');
    expect(() => selectDistributionArtifacts({ generatedArtifacts: [createBuildArtifact({ path: '_rendered/content/article.html', content: 'body' })], scope: { kind: 'full' }, publicFiles: [] })).toThrow('dependency metadata');
  });
  it('excludes a missing asset used only by an unrelated article', () => {
    const unrelated = article('other', [], ['content/missing.svg']);
    const selected = selectDistributionArtifacts({ generatedArtifacts: [...artifacts, unrelated], scope: { kind: 'incremental', targetSlugs: ['article'] }, publicFiles: [] });
    expect(selected.assets).not.toContain('content/missing.svg');
    expect(selectDistributionArtifacts({ generatedArtifacts: [...artifacts, unrelated], scope: { kind: 'full' }, publicFiles: [] }).assets).toContain('content/missing.svg');
  });
});
