import { describe, expect, it } from 'vitest';
import { getWordPressEndpoint } from './configuration';

describe('WordPress endpoint configuration', () => {
  it('uses the explicit endpoint and normalizes its trailing slash', () => {
    expect(getWordPressEndpoint({ site: {
      siteId: 'example', vaultPath: 'vault', domain: 'other.example.com',
      wordpress: { username: 'editor', applicationPassword: 'example-password', endpoint: 'https://wordpress.example.com/wp-json/' },
    } })).toBe('https://wordpress.example.com/wp-json');
  });
  it('uses a domain when no explicit endpoint is configured', () => {
    expect(getWordPressEndpoint({ site: { siteId: 'example', vaultPath: 'vault', domain: 'example.com' } })).toBe('https://example.com/wp-json');
  });
  it('does not invent an endpoint when both configuration fields are absent', () => {
    expect(() => getWordPressEndpoint({ site: { siteId: 'example', vaultPath: 'vault' } })).toThrow('requires an endpoint');
  });
});
