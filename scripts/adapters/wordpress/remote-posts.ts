import { z } from 'zod';

export type WordPressPostLocator = {
  restBase: 'posts' | 'pages';
  slug: string;
};

type Request = ({ path }: { path: string }) => Promise<unknown>;

const WordPressPostIdentitySchema = z.object({
  id: z.number().int().positive(),
  slug: z.string().optional(),
});
const WordPressPostIdentityListSchema = z.array(WordPressPostIdentitySchema);
const LOOKUP_BATCH_SIZE = 50;

function identityKey({ restBase, slug }: WordPressPostLocator): string {
  return `${restBase}:${slug}`;
}

export async function findWordPressPostIds({
  locators,
  request,
}: {
  locators: readonly WordPressPostLocator[];
  request: Request;
}): Promise<ReadonlyMap<string, number>> {
  const ids = new Map<string, number>();
  const uniqueByKey = new Map(locators.map((locator) => [identityKey(locator), locator]));

  for (const restBase of ['posts', 'pages'] as const) {
    const matching = [...uniqueByKey.values()].filter((locator) => locator.restBase === restBase);
    for (let offset = 0; offset < matching.length; offset += LOOKUP_BATCH_SIZE) {
      const batch = matching.slice(offset, offset + LOOKUP_BATCH_SIZE);
      if (batch.length === 0) continue;

      const path = batch.length === 1
        ? `/wp/v2/${restBase}?slug=${encodeURIComponent(batch[0].slug)}&status=any`
        : `/wp/v2/${restBase}?${batch
          .map(({ slug }) => `slug%5B%5D=${encodeURIComponent(slug)}`)
          .join('&')}&status=any&per_page=${batch.length}&_fields=id,slug`;
      const result = WordPressPostIdentityListSchema.safeParse(await request({ path }));
      if (!result.success) {
        throw new Error(`WordPress returned an invalid ${restBase} discovery response.`);
      }

      if (batch.length === 1 && result.data[0]) {
        ids.set(identityKey(batch[0]), result.data[0].id);
        continue;
      }
      for (const identity of result.data) {
        if (identity.slug) ids.set(identityKey({ restBase, slug: identity.slug }), identity.id);
      }
    }
  }

  return ids;
}

export function getWordPressPostId({
  ids,
  locator,
}: {
  ids: ReadonlyMap<string, number>;
  locator: WordPressPostLocator;
}): number | undefined {
  return ids.get(identityKey(locator));
}
