import { describe, expect, it } from 'vitest';
import type { Site } from '../../src/domain/registry';
import {
  createWordPressPublisherAdapters,
  hasWordPressPublisher,
  LEGACY_WORDPRESS_PUBLISHER_ID,
} from './wordpress-publisher-adapter';

describe('WordPress publisher adapter configuration', () => {
  it('preserves the legacy site.wordpress configuration', () => {
    const site: Site = {
      siteId: 'example',
      vaultPath: 'vault',
      wordpress: { username: 'editor', applicationPassword: 'secret' },
    };

    expect(createWordPressPublisherAdapters({ site }).map((adapter) => adapter.id)).toEqual([
      LEGACY_WORDPRESS_PUBLISHER_ID,
    ]);
    expect(hasWordPressPublisher({ site })).toBe(true);
  });

  it('creates independently named adapters from generic publisher definitions', () => {
    const site: Site = {
      siteId: 'example',
      vaultPath: 'vault',
      publishers: [{
        id: 'wordpress-primary',
        type: 'wordpress',
        config: {
          username: 'editor',
          applicationPassword: 'secret',
          endpoint: 'https://example.com/wp-json',
        },
      }],
    };

    expect(createWordPressPublisherAdapters({ site }).map((adapter) => adapter.id)).toEqual([
      'wordpress-primary',
    ]);
    expect(hasWordPressPublisher({ site })).toBe(true);
  });
});
