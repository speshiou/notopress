import { describe, expect, it } from 'vitest';
import { parseContentTaxonomies } from './content-metadata';

describe('parseContentTaxonomies', () => {
  it('keeps optional taxonomy fields absent', () => {
    expect(parseContentTaxonomies({ frontmatter: { title: 'Post' } })).toEqual({
      categories: undefined,
      tags: undefined,
    });
  });

  it('trims and deduplicates taxonomy slugs', () => {
    expect(parseContentTaxonomies({
      frontmatter: {
        categories: ['engineering', ' engineering ', 'product'],
        tags: ['nextjs', 'publishing', 'nextjs'],
      },
    })).toEqual({
      categories: ['engineering', 'product'],
      tags: ['nextjs', 'publishing'],
    });
  });

  it('rejects non-array taxonomy values', () => {
    expect(() => parseContentTaxonomies({
      frontmatter: { categories: 'engineering' },
    })).toThrow('arrays of non-empty slugs');
  });
});
