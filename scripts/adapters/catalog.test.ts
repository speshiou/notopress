import { describe, expect, it } from 'vitest';
import type { Site } from '../../src/domain/registry';
import { createConfiguredPublisherAdapters, hasConfiguredPublisherType } from './catalog';

describe('publisher adapter catalog', () => {
  it('builds configured adapters without exposing platform details to the application layer', () => {
    const site: Site = {
      siteId: 'example',
      vaultPath: 'vault',
      publishers: [{
        id: 'wordpress-main',
        type: 'wordpress',
        config: { username: 'editor', applicationPassword: 'secret' },
      }],
    };

    expect(createConfiguredPublisherAdapters({ site }).map(({ id, type }) => ({ id, type }))).toEqual([
      { id: 'wordpress-main', type: 'wordpress' },
    ]);
    expect(hasConfiguredPublisherType({ site, type: 'wordpress' })).toBe(true);
    expect(hasConfiguredPublisherType({ site, type: 'unknown' })).toBe(false);
  });
});
