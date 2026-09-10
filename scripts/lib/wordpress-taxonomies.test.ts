import { describe, expect, it, vi } from 'vitest';
import { createWordPressTaxonomyResolver, formatTaxonomyFrontmatterLines } from './wordpress-taxonomies';

describe('createWordPressTaxonomyResolver', () => {
  it('resolves optional taxonomy slugs to WordPress IDs', async () => {
    const request = vi.fn(async ({ path }: { path: string }) => {
      if (path.includes('/categories?')) return [{ id: 12, slug: 'engineering' }];
      if (path.includes('slug=nextjs')) return [{ id: 34, slug: 'nextjs' }];
      return [{ id: 56, slug: 'publishing' }];
    });
    const resolver = createWordPressTaxonomyResolver({ request });

    await expect(resolver.resolvePayload({
      taxonomies: {
        categories: ['engineering'],
        tags: ['nextjs', 'publishing'],
      },
    })).resolves.toEqual({ categories: [12], tags: [34, 56] });
  });

  it('omits unmanaged taxonomies and preserves explicit empty arrays', async () => {
    const request = vi.fn(async () => []);
    const resolver = createWordPressTaxonomyResolver({ request });

    await expect(resolver.resolvePayload({
      taxonomies: { categories: [] },
    })).resolves.toEqual({ categories: [] });
    expect(request).not.toHaveBeenCalled();
  });

  it('preloads taxonomy slugs in one request per taxonomy', async () => {
    const request = vi.fn(async ({ path }: { path: string }) => {
      if (path.includes('/categories?')) return [{ id: 12, slug: 'engineering' }];
      return [
        { id: 34, slug: 'nextjs' },
        { id: 56, slug: 'publishing' },
      ];
    });
    const resolver = createWordPressTaxonomyResolver({ request });

    await resolver.preloadPayloads({
      taxonomies: [
        { categories: ['engineering'], tags: ['nextjs'] },
        { categories: ['engineering'], tags: ['publishing'] },
      ],
    });
    await expect(resolver.resolvePayload({
      taxonomies: { categories: ['engineering'], tags: ['nextjs', 'publishing'] },
    })).resolves.toEqual({ categories: [12], tags: [34, 56] });

    expect(request).toHaveBeenCalledTimes(2);
  });

  it('fails with an actionable error for unknown slugs', async () => {
    const resolver = createWordPressTaxonomyResolver({ request: vi.fn(async () => []) });

    await expect(resolver.resolvePayload({
      taxonomies: { tags: ['unknown-tag'] },
    })).rejects.toThrow('WordPress tags slug "unknown-tag" does not exist');
  });

  it('creates missing taxonomy slugs when enabled and caches their IDs', async () => {
    const request = vi.fn(async ({ method }: { method?: 'GET' | 'POST' }) => {
      if (method === 'POST') return { id: 78, slug: 'stock-analysis' };
      return [];
    });
    const resolver = createWordPressTaxonomyResolver({ request, createMissingTerms: true });

    await expect(resolver.resolvePayload({
      taxonomies: { tags: ['stock-analysis', 'stock-analysis'] },
    })).resolves.toEqual({ tags: [78, 78] });
    expect(request).toHaveBeenCalledWith({
      path: '/wp/v2/tags',
      method: 'POST',
      body: { name: 'stock-analysis', slug: 'stock-analysis' },
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('recovers when another sync creates a missing term first', async () => {
    let lookupCount = 0;
    const request = vi.fn(async ({ method }: { method?: 'GET' | 'POST' }) => {
      if (method === 'POST') throw new Error('term_exists');
      lookupCount += 1;
      return lookupCount === 1 ? [] : [{ id: 91, slug: 'annual-calendar' }];
    });
    const resolver = createWordPressTaxonomyResolver({ request, createMissingTerms: true });

    await expect(resolver.resolvePayload({
      taxonomies: { tags: ['annual-calendar'] },
    })).resolves.toEqual({ tags: [91] });
  });

  it('resolves WordPress term IDs back to frontmatter slugs', async () => {
    const request = vi.fn(async ({ path }: { path: string }) => (
      path.includes('/categories?')
        ? [{ id: 12, slug: 'engineering' }]
        : [{ id: 34, slug: 'nextjs' }]
    ));
    const resolver = createWordPressTaxonomyResolver({ request });

    await expect(resolver.resolveFrontmatter({ categoryIds: [12], tagIds: [34] })).resolves.toEqual({
      categories: ['engineering'],
      tags: ['nextjs'],
    });
  });
});

describe('formatTaxonomyFrontmatterLines', () => {
  it('formats only present taxonomy fields as quoted YAML list items', () => {
    expect(formatTaxonomyFrontmatterLines({
      taxonomies: { tags: ['nextjs', 'content publishing'] },
    })).toEqual([
      'tags:',
      '  - "nextjs"',
      '  - "content publishing"',
    ]);
  });

  it('formats an explicit empty taxonomy as an empty YAML array', () => {
    expect(formatTaxonomyFrontmatterLines({
      taxonomies: { categories: [] },
    })).toEqual(['categories: []']);
  });
});
