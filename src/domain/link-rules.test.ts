import { describe, expect, it } from 'vitest';
import { LinkRulesSchema } from './link-rules';
import { RegistrySchema } from './registry';

describe('link rule configuration', () => {
  it('accepts site rules and normalizes DNS hostname spelling', () => {
    const registry = RegistrySchema.parse({ sites: [{ siteId: 'example', vaultPath: 'vault', linkRules: [{
      name: 'Affiliate links', hostnames: [' Affiliate.Example.COM. ', 'shop.example.com'],
      includeSubdomains: true, query: { ref: 'my-code' }, rel: ['sponsored', 'nofollow'],
    }] }] });
    expect(registry.sites[0].linkRules?.[0].hostnames).toEqual(['affiliate.example.com', 'shop.example.com']);
    expect(LinkRulesSchema.parse([])).toEqual([]);
    expect(LinkRulesSchema.parse([{ hostnames: ['example.com'], target: '_blank' }])[0].target).toBe('_blank');
  });

  it.each([
    { hostnames: [], rel: ['sponsored'] },
    { hostnames: ['example.com'] },
    { hostnames: ['example.com'], target: 'named-window' },
    { hostnames: ['example.com'], target: '_parent' },
    { hostnames: ['https://example.com'], rel: ['sponsored'] },
    { hostnames: ['example.com/path'], rel: ['sponsored'] },
    { hostnames: ['example.com:443'], rel: ['sponsored'] },
    { hostnames: ['*.example.com'], rel: ['sponsored'] },
    { hostnames: ['-invalid.example'], rel: ['sponsored'] },
    { hostnames: ['example.com'], rel: [] },
    { hostnames: ['example.com'], rel: ['not-a-rel'] },
    { hostnames: ['example.com'], rel: ['sponsored'], query: { ref: 123 } },
    { hostnames: ['example.com'], rel: ['sponsored'], includeSubdomains: 'yes' },
    { hostname: 'example.com', rel: ['sponsored'] },
  ])('rejects invalid rule configuration: %j', (rule) => {
    expect(LinkRulesSchema.safeParse([rule]).success).toBe(false);
  });
});
