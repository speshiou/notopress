import { ContentTaxonomiesSchema, type ContentTaxonomies } from '../domain/content-metadata';

function deduplicateSlugs(slugs: readonly string[] | undefined): string[] | undefined {
  return slugs ? [...new Set(slugs)] : undefined;
}

export function parseContentTaxonomies({
  frontmatter,
}: {
  frontmatter: Record<string, unknown>;
}): ContentTaxonomies {
  const result = ContentTaxonomiesSchema.safeParse(frontmatter);
  if (!result.success) {
    throw new Error(
      'Invalid content taxonomies. Expected optional "categories" and "tags" frontmatter fields to be arrays of non-empty slugs.'
    );
  }

  return {
    categories: deduplicateSlugs(result.data.categories),
    tags: deduplicateSlugs(result.data.tags),
  };
}
