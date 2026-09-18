import type { Site } from '../../src/domain/registry';
import type { PublisherAdapter } from '../core/publishing/publisher';
import {
  createWordPressPublisherAdapters,
  WORDPRESS_PUBLISHER_TYPE,
} from './wordpress/adapter';

export function createConfiguredPublisherAdapters({ site }: { site: Site }): PublisherAdapter[] {
  return [
    ...createWordPressPublisherAdapters({ site }),
  ];
}

export function hasConfiguredPublisherType({
  site,
  type,
}: {
  site: Site;
  type: string;
}): boolean {
  if (type === WORDPRESS_PUBLISHER_TYPE && site.wordpress) return true;
  return Boolean(site.publishers?.some((publisher) => publisher.type === type));
}
