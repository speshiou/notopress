import { describe, expect, it } from 'vitest';
import {
  applyRewrites,
  buildRouteTable,
  composeFullSlug,
  getContentImageFolder,
  getNoteHref,
  listVaultFullSlugCandidates,
  toPublicSlug,
} from './rewrites';

const flattenRules = [
  { source: 'guides/:path*', destination: '/:path*' },
  { source: 'reviews/:path*', destination: '/:path*' },
];

describe('toPublicSlug', () => {
  it('strips the reserved index slug', () => {
    expect(toPublicSlug({ fullSlug: 'page' })).toBe('page');
    expect(toPublicSlug({ fullSlug: 'blog/page' })).toBe('blog');
    expect(toPublicSlug({ fullSlug: 'guides/vpn' })).toBe('guides/vpn');
  });
});

describe('getNoteHref', () => {
  it('maps public slugs to route hrefs', () => {
    expect(getNoteHref({ publicSlug: 'page' })).toBe('/');
    expect(getNoteHref({ publicSlug: 'blog' })).toBe('/blog');
    expect(getNoteHref({ publicSlug: 'guides/example-note' })).toBe('/guides/example-note');
  });
});

describe('applyRewrites', () => {
  it('keeps identity mapping when no rules match', () => {
    expect(applyRewrites({ fullSlug: 'blog/hello', rules: flattenRules })).toBe('blog/hello');
    expect(applyRewrites({ fullSlug: 'about' })).toBe('about');
  });

  it('flattens matching prefixes onto the destination', () => {
    expect(applyRewrites({ fullSlug: 'guides/vpn', rules: flattenRules })).toBe('vpn');
    expect(applyRewrites({ fullSlug: 'guides/nested/vpn', rules: flattenRules })).toBe('nested/vpn');
    expect(applyRewrites({ fullSlug: 'reviews/product-a', rules: flattenRules })).toBe('product-a');
    expect(applyRewrites({ fullSlug: 'guides/page', rules: flattenRules })).toBe('page');
  });

  it('uses the first matching rule', () => {
    const rules = [
      { source: 'guides/:path*', destination: '/docs/:path*' },
      { source: 'guides/:path*', destination: '/:path*' },
    ];
    expect(applyRewrites({ fullSlug: 'guides/vpn', rules })).toBe('docs/vpn');
  });
});

describe('buildRouteTable', () => {
  it('builds identity routes without rewrite rules', () => {
    const table = buildRouteTable({ fullSlugs: ['page', 'about', 'blog/hello', 'blog/page'] });
    expect(table.routes).toEqual({
      page: 'page',
      about: 'about',
      'blog/hello': 'blog/hello',
      blog: 'blog/page',
    });
    expect(table.publicDirectories).toEqual(['blog']);
    expect(table.shadows).toEqual([]);
  });

  it('keeps the same public slug after moving between flattened prefixes', () => {
    expect(applyRewrites({ fullSlug: 'guides/vpn', rules: flattenRules })).toBe('vpn');
    expect(applyRewrites({ fullSlug: 'reviews/vpn', rules: flattenRules })).toBe('vpn');
  });

  it('serves the earlier rewrite rule and warns about shadowed files', () => {
    const table = buildRouteTable({
      fullSlugs: ['page', 'guides/vpn', 'reviews/vpn', 'guides/page'],
      rules: flattenRules,
    });

    expect(table.routes.vpn).toBe('guides/vpn');
    expect(table.routes.page).toBe('guides/page');
    expect(table.shadows).toEqual([
      {
        publicSlug: 'vpn',
        winnerFullSlug: 'guides/vpn',
        shadowedFullSlug: 'reviews/vpn',
      },
      {
        publicSlug: 'page',
        winnerFullSlug: 'guides/page',
        shadowedFullSlug: 'page',
      },
    ]);
    expect(table.publicDirectories).toEqual([]);
  });
});

describe('listVaultFullSlugCandidates', () => {
  it('stats rewrite sources in rule order before identity', () => {
    expect(listVaultFullSlugCandidates({ slugOrId: 'vpn', wpSlug: 'vpn', rules: flattenRules })).toEqual([
      'guides/vpn',
      'reviews/vpn',
      'vpn',
    ]);
  });

  it('accepts vault paths from the CLI', () => {
    expect(listVaultFullSlugCandidates({ slugOrId: 'guides/vpn', rules: flattenRules })).toContain('guides/vpn');
  });
});

describe('path helpers', () => {
  it('composes and splits full slugs', () => {
    expect(composeFullSlug({ directory: 'guides', slug: 'vpn' })).toBe('guides/vpn');
    expect(composeFullSlug({ directory: '', slug: 'about' })).toBe('about');
    expect(getContentImageFolder({ fullSlug: 'guides/vpn' })).toBe('guides');
    expect(getContentImageFolder({ fullSlug: 'vpn' })).toBe('vpn');
  });
});
