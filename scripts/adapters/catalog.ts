import type { Site } from '../../src/domain/registry';
import type { ContentPlatformAdapter } from '../core/publishing/platform-adapter';
import {
  createWordPressPlatformAdapters,
  WORDPRESS_PLATFORM_TYPE,
} from './wordpress/adapter';

export function createConfiguredPlatformAdapters({ site }: { site: Site }): ContentPlatformAdapter[] {
  return [
    ...createWordPressPlatformAdapters({ site }),
  ];
}

export function hasConfiguredPlatformType({
  site,
  type,
}: {
  site: Site;
  type: string;
}): boolean {
  if (type === WORDPRESS_PLATFORM_TYPE && site.wordpress) return true;
  return Boolean(site.publishers?.some((platform) => platform.type === type));
}
