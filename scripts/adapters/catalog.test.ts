import { describe, expect, it } from 'vitest';
import type { Site } from '../../src/domain/registry';
import { createConfiguredPlatformAdapters, hasConfiguredPlatformType } from './catalog';

describe('platform adapter catalog', () => {
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

    expect(createConfiguredPlatformAdapters({ site }).map(({ id, type }) => ({ id, type }))).toEqual([
      { id: 'wordpress-main', type: 'wordpress' },
    ]);
    expect(hasConfiguredPlatformType({ site, type: 'wordpress' })).toBe(true);
    expect(hasConfiguredPlatformType({ site, type: 'unknown' })).toBe(false);
  });
});
