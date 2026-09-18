import { describe, expect, it } from 'vitest';
import type { Site } from '../../../src/domain/registry';
import {
  createWordPressPlatformAdapters,
  LEGACY_WORDPRESS_PLATFORM_ID,
} from './adapter';

describe('WordPress publisher adapter configuration', () => {
  it('preserves the legacy site.wordpress configuration', () => {
    const site: Site = {
      siteId: 'example',
      vaultPath: 'vault',
      wordpress: { username: 'editor', applicationPassword: 'secret' },
    };

    expect(createWordPressPlatformAdapters({ site }).map((adapter) => adapter.id)).toEqual([
      LEGACY_WORDPRESS_PLATFORM_ID,
    ]);
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

    expect(createWordPressPlatformAdapters({ site }).map((adapter) => adapter.id)).toEqual([
      'wordpress-primary',
    ]);
  });
});
