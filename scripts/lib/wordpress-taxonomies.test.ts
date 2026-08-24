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

  it('fails with an actionable error for unknown slugs', async () => {
    const resolver = createWordPressTaxonomyResolver({ request: vi.fn(async () => []) });

    await expect(resolver.resolvePayload({
      taxonomies: { tags: ['unknown-tag'] },
    })).rejects.toThrow('WordPress tags slug "unknown-tag" does not exist');
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
