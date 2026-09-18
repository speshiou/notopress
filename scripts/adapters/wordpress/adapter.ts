import { WordPressCredentialsSchema, type PublisherDefinition, type Site } from '../../../src/domain/registry';
import type { PublisherAdapter } from '../../core/publishing/publisher';
import { prepareWordPressPublisher, pullFromWordPress } from './wordpress';

export const WORDPRESS_PUBLISHER_TYPE = 'wordpress';
export const LEGACY_WORDPRESS_PUBLISHER_ID = 'wordpress';

function createAdapter({
  id,
  site,
}: {
  id: string;
  site: Site;
}): PublisherAdapter {
  return {
    id,
    type: WORDPRESS_PUBLISHER_TYPE,
    preparePublication: async (context) => {
      const prepared = await prepareWordPressPublisher({
        ...context,
        site,
      });
      return prepared ? { ...prepared, id } : null;
    },
    initializeState: async (context) => {
      await prepareWordPressPublisher({ ...context, site, markSynced: true });
    },
    importResource: async (context) => {
      await pullFromWordPress({
        site,
        registry: context.registry,
        slugOrId: context.resource,
        dryRun: context.dryRun,
      });
    },
  };
}

export function createWordPressPublisherAdapters({
  site,
}: {
  site: Site;
}): PublisherAdapter[] {
  const adapters: PublisherAdapter[] = [];

  if (site.wordpress) {
    adapters.push(createAdapter({ id: LEGACY_WORDPRESS_PUBLISHER_ID, site }));
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
