import { describe, expect, it } from 'vitest';
import { RegistrySchema } from './registry';

describe('publisher registry configuration', () => {
  it('accepts generic publisher definitions without core knowing adapter config fields', () => {
    const result = RegistrySchema.safeParse({
      sites: [{
        siteId: 'example',
        vaultPath: 'vault',
        publishers: [{
          id: 'example-primary',
          type: 'example-platform',
          config: { token: 'secret', customOption: true },
        }],
      }],
    });

    expect(result.success).toBe(true);
  });

  it('keeps legacy WordPress configuration valid during migration', () => {
    const result = RegistrySchema.safeParse({
      sites: [{
        siteId: 'example',
        vaultPath: 'vault',
        wordpress: { username: 'editor', applicationPassword: 'secret' },
      }],
    });

    expect(result.success).toBe(true);
  });
});
