import { WordPressCredentialsSchema, type Site } from '../../../src/domain/registry';
import type { ContentPlatformAdapter } from '../../core/publishing/platform-adapter';
import { importFromWordPress, prepareWordPressPublication } from './wordpress';

export const WORDPRESS_PLATFORM_TYPE = 'wordpress';
export const LEGACY_WORDPRESS_PLATFORM_ID = 'wordpress';

function createAdapter({
  id,
  site,
}: {
  id: string;
  site: Site;
}): ContentPlatformAdapter {
  return {
    id,
    type: WORDPRESS_PLATFORM_TYPE,
    preparePublication: async (context) => {
      const prepared = await prepareWordPressPublication({
        ...context,
        site,
      });
      return prepared ? { ...prepared, id } : null;
    },
    initializeState: async (context) => {
      await prepareWordPressPublication({ ...context, site, initializeState: true });
    },
    importResource: async (context) => {
      await importFromWordPress({
        site,
        registry: context.registry,
        slugOrId: context.resource,
        dryRun: context.dryRun,
      });
    },
  };
}

export function createWordPressPlatformAdapters({
  site,
}: {
  site: Site;
}): ContentPlatformAdapter[] {
  const adapters: ContentPlatformAdapter[] = [];

  if (site.wordpress) {
    adapters.push(createAdapter({ id: LEGACY_WORDPRESS_PLATFORM_ID, site }));
  }

  for (const definition of site.publishers || []) {
    if (definition.type !== WORDPRESS_PLATFORM_TYPE) continue;
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
