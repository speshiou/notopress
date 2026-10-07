import type { Site } from '../../../src/domain/registry';

export function getWordPressEndpoint({ site }: { site: Site }): string {
  const configured = site.wordpress?.endpoint;
  if (configured) return configured.replace(/\/+$/, '');
  if (!site.domain) throw new Error('WordPress requires an endpoint or a site domain.');
  return `https://${site.domain}/wp-json`;
}
