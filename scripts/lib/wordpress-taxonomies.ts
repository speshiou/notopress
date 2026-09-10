import { z } from 'zod';
import type { ContentTaxonomies } from '../../src/domain/content-metadata';

type WordPressTaxonomyRestBase = 'categories' | 'tags';

type WordPressTaxonomyRequest = ({
  path,
  method,
  body,
}: {
  path: string;
  method?: 'GET' | 'POST';
  body?: unknown;
}) => Promise<unknown>;

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
const TERM_LOOKUP_BATCH_SIZE = 100;

function parseTerms({ value, taxonomy }: { value: unknown; taxonomy: WordPressTaxonomyRestBase }) {
  const result = WordPressTermsSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`WordPress returned an invalid ${taxonomy} response.`);
  }
  return result.data;
}

function parseTerm({ value, taxonomy }: { value: unknown; taxonomy: WordPressTaxonomyRestBase }) {
  const result = WordPressTermSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`WordPress returned an invalid ${taxonomy} term response.`);
  }
  return result.data;
}

export function createWordPressTaxonomyResolver({
  request,
  createMissingTerms = false,
}: {
  request: WordPressTaxonomyRequest;
  createMissingTerms?: boolean;
}) {
  const termIdCache = new Map<string, number>();

  async function findTerm({
    taxonomy,
    slug,
  }: {
    taxonomy: WordPressTaxonomyRestBase;
    slug: string;
  }) {
    const response = await request({
      path: `/wp/v2/${taxonomy}?slug=${encodeURIComponent(slug)}&per_page=100`,
    });
    const terms = parseTerms({ value: response, taxonomy });
    return terms.find((candidate) => candidate.slug === slug);
  }

  async function createTerm({
    taxonomy,
    slug,
  }: {
    taxonomy: WordPressTaxonomyRestBase;
    slug: string;
  }) {
    try {
      const response = await request({
        path: `/wp/v2/${taxonomy}`,
        method: 'POST',
        body: { name: slug, slug },
      });
      return parseTerm({ value: response, taxonomy });
    } catch (error: unknown) {
      const term = await findTerm({ taxonomy, slug });
      if (term) return term;
      throw error;
    }
  }

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

      const existingTerm = await findTerm({ taxonomy, slug });
      const term = existingTerm || (createMissingTerms
        ? await createTerm({ taxonomy, slug })
        : undefined);
      if (!term) {
        throw new Error(
          `WordPress ${taxonomy} slug "${slug}" does not exist. Run a live sync to create it or remove it from the article frontmatter.`
        );
      }

      termIdCache.set(cacheKey, term.id);
      ids.push(term.id);
    }

    return ids;
  }

  async function preloadSlugs({
    taxonomy,
    slugs,
  }: {
    taxonomy: WordPressTaxonomyRestBase;
    slugs: readonly string[];
  }): Promise<void> {
    const uncachedSlugs = [...new Set(slugs)].filter(
      (slug) => !termIdCache.has(`${taxonomy}:${slug}`)
    );

    for (let offset = 0; offset < uncachedSlugs.length; offset += TERM_LOOKUP_BATCH_SIZE) {
      const batch = uncachedSlugs.slice(offset, offset + TERM_LOOKUP_BATCH_SIZE);
      const slugQuery = batch.map(encodeURIComponent).join(',');
      const response = await request({
        path: `/wp/v2/${taxonomy}?slug=${slugQuery}&per_page=${TERM_LOOKUP_BATCH_SIZE}`,
      });
      const terms = parseTerms({ value: response, taxonomy });
      for (const term of terms) {
        termIdCache.set(`${taxonomy}:${term.slug}`, term.id);
      }
    }
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
    async preloadPayloads({
      taxonomies,
    }: {
      taxonomies: readonly ContentTaxonomies[];
    }): Promise<void> {
      const categories = taxonomies.flatMap((value) => value.categories || []);
      const tags = taxonomies.flatMap((value) => value.tags || []);
      await Promise.all([
        preloadSlugs({ taxonomy: 'categories', slugs: categories }),
        preloadSlugs({ taxonomy: 'tags', slugs: tags }),
      ]);
    },

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
