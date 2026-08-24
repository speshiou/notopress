import { z } from 'zod';
import type { ContentTaxonomies } from '../../src/domain/content-metadata';

type WordPressTaxonomyRestBase = 'categories' | 'tags';

type WordPressTaxonomyRequest = ({ path }: { path: string }) => Promise<unknown>;

const WordPressTermSchema = z.object({
  id: z.number().int().positive(),
  slug: z.string(),
});

const WordPressTermsSchema = z.array(WordPressTermSchema);

export type WordPressTaxonomyPayload = {
  categories?: number[];
  tags?: number[];
};

const TAXONOMY_FIELDS: readonly (keyof ContentTaxonomies)[] = ['categories', 'tags'];

function parseTerms({ value, taxonomy }: { value: unknown; taxonomy: WordPressTaxonomyRestBase }) {
  const result = WordPressTermsSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`WordPress returned an invalid ${taxonomy} response.`);
  }
  return result.data;
}

export function createWordPressTaxonomyResolver({
  request,
}: {
  request: WordPressTaxonomyRequest;
}) {
  const termIdCache = new Map<string, number>();

  async function resolveSlugs({
    taxonomy,
    slugs,
  }: {
    taxonomy: WordPressTaxonomyRestBase;
    slugs: readonly string[];
  }): Promise<number[]> {
    const ids: number[] = [];

    for (const slug of slugs) {
      const cacheKey = `${taxonomy}:${slug}`;
      const cachedId = termIdCache.get(cacheKey);
      if (cachedId !== undefined) {
        ids.push(cachedId);
        continue;
      }

      const response = await request({
        path: `/wp/v2/${taxonomy}?slug=${encodeURIComponent(slug)}&per_page=100`,
      });
      const terms = parseTerms({ value: response, taxonomy });
      const term = terms.find((candidate) => candidate.slug === slug);
      if (!term) {
        throw new Error(
          `WordPress ${taxonomy} slug "${slug}" does not exist. Create it in WordPress or remove it from the article frontmatter.`
        );
      }

      termIdCache.set(cacheKey, term.id);
      ids.push(term.id);
    }

    return ids;
  }

  async function resolveIds({
    taxonomy,
    ids,
  }: {
    taxonomy: WordPressTaxonomyRestBase;
    ids: readonly number[];
  }): Promise<string[]> {
    if (ids.length === 0) return [];

    const response = await request({
      path: `/wp/v2/${taxonomy}?include=${ids.join(',')}&per_page=100`,
    });
    const terms = parseTerms({ value: response, taxonomy });
    const termsById = new Map(terms.map((term) => [term.id, term.slug]));

    return ids.map((id) => {
      const slug = termsById.get(id);
      if (!slug) {
        throw new Error(`WordPress ${taxonomy} term ID ${id} could not be resolved to a slug.`);
      }
      return slug;
    });
  }

  return {
    async resolvePayload({
      taxonomies,
    }: {
      taxonomies: ContentTaxonomies;
    }): Promise<WordPressTaxonomyPayload> {
      const payload: WordPressTaxonomyPayload = {};
      if (taxonomies.categories !== undefined) {
        payload.categories = await resolveSlugs({ taxonomy: 'categories', slugs: taxonomies.categories });
      }
      if (taxonomies.tags !== undefined) {
        payload.tags = await resolveSlugs({ taxonomy: 'tags', slugs: taxonomies.tags });
      }
      return payload;
    },

    async resolveFrontmatter({
      categoryIds,
      tagIds,
    }: {
      categoryIds: readonly number[];
      tagIds: readonly number[];
    }): Promise<ContentTaxonomies> {
      const categories = await resolveIds({ taxonomy: 'categories', ids: categoryIds });
      const tags = await resolveIds({ taxonomy: 'tags', ids: tagIds });
      return {
        categories: categories.length > 0 ? categories : undefined,
        tags: tags.length > 0 ? tags : undefined,
      };
    },
  };
}

export function formatTaxonomyFrontmatterLines({
  taxonomies,
}: {
  taxonomies: ContentTaxonomies;
}): string[] {
  const lines: string[] = [];
  for (const taxonomy of TAXONOMY_FIELDS) {
    const slugs = taxonomies[taxonomy];
    if (slugs === undefined) continue;
    if (slugs.length === 0) {
      lines.push(`${taxonomy}: []`);
      continue;
    }
    lines.push(`${taxonomy}:`);
    lines.push(...slugs.map((slug) => `  - ${JSON.stringify(slug)}`));
  }
  return lines;
}
