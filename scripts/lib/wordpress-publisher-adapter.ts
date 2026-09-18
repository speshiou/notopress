import { WordPressCredentialsSchema, type PublisherDefinition, type Site } from '../../src/domain/registry';
import type { PublisherAdapter } from './publisher';
import { prepareWordPressPublisher } from './wordpress';

export const WORDPRESS_PUBLISHER_TYPE = 'wordpress';
export const LEGACY_WORDPRESS_PUBLISHER_ID = 'wordpress';

function createAdapter({
  id,
  site,
  markSynced,
}: {
  id: string;
  site: Site;
  markSynced?: boolean;
}): PublisherAdapter {
  return {
    id,
    type: WORDPRESS_PUBLISHER_TYPE,
    prepare: async (context) => {
      const prepared = await prepareWordPressPublisher({
        ...context,
        site,
        markSynced,
      });
      return prepared ? { ...prepared, id } : null;
    },
  };
}

export function createWordPressPublisherAdapters({
  site,
  markSynced,
}: {
  site: Site;
  markSynced?: boolean;
}): PublisherAdapter[] {
  const adapters: PublisherAdapter[] = [];

  if (site.wordpress) {
    adapters.push(createAdapter({ id: LEGACY_WORDPRESS_PUBLISHER_ID, site, markSynced }));
  }

  for (const definition of site.publishers || []) {
    if (definition.type !== WORDPRESS_PUBLISHER_TYPE) continue;
    const credentialsResult = WordPressCredentialsSchema.safeParse(definition.config);
    if (!credentialsResult.success) {
      throw new Error(`Invalid WordPress publisher configuration for "${definition.id}".`);
    }
    adapters.push(createAdapter({
      id: definition.id,
      site: { ...site, wordpress: credentialsResult.data },
      markSynced,
    }));
  }

  return adapters;
}

export function hasWordPressPublisher({ site }: { site: Site }): boolean {
  return Boolean(
    site.wordpress || site.publishers?.some((definition: PublisherDefinition) => (
      definition.type === WORDPRESS_PUBLISHER_TYPE
    ))
  );
}
