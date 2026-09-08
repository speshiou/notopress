import { INDEX_SLUG } from './constants';
import type { RewriteRule } from '../domain/rewrites';

export type { RewriteRule, RewriteRules } from '../domain/rewrites';

export type RouteTable = {
  routes: Record<string, string>;
  publicSlugByFullSlug: Record<string, string>;
  publicDirectories: string[];
  shadows: readonly {
    publicSlug: string;
    winnerFullSlug: string;
    shadowedFullSlug: string;
  }[];
};

function uniqueStrings(values: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

function splitPattern({ pattern }: { pattern: string }): string[] {
  return pattern.replace(/^\//, '').split('/').filter(Boolean);
}

export function composeFullSlug({ directory, slug }: { directory: string; slug: string }): string {
  return directory ? `${directory}/${slug}` : slug;
}

export function splitFullSlug({ fullSlug }: { fullSlug: string }): { directory: string; slug: string } {
  const segments = fullSlug.split('/').filter(Boolean);
  const slug = segments[segments.length - 1] || fullSlug;
  const directory = segments.slice(0, -1).join('/');
  return { directory, slug };
}

export function getContentImageFolder({ fullSlug }: { fullSlug: string }): string {
  const { directory, slug } = splitFullSlug({ fullSlug });
  return directory || slug;
}

export function toPublicSlug({ fullSlug }: { fullSlug: string }): string {
  const segments = fullSlug.split('/').filter(Boolean);
  if (segments.length === 0 || (segments.length === 1 && segments[0] === INDEX_SLUG)) {
    return INDEX_SLUG;
  }

  const lastSegment = segments[segments.length - 1];
  const urlSegments = lastSegment === INDEX_SLUG ? segments.slice(0, -1) : segments;
  if (urlSegments.length === 0) {
    return INDEX_SLUG;
  }
  return urlSegments.join('/');
}

export function getNoteHref({ publicSlug }: { publicSlug: string }): string {
  if (!publicSlug || publicSlug === INDEX_SLUG) {
    return '/';
  }

  const urlPath = publicSlug
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `/${urlPath}`;
}

function matchSource({ source, fullSlug }: { source: string; fullSlug: string }): Record<string, string> | null {
  const sourceParts = splitPattern({ pattern: source });
  const valueParts = fullSlug.split('/').filter(Boolean);
  const captures: Record<string, string> = {};
  let valueIndex = 0;

  for (let partIndex = 0; partIndex < sourceParts.length; partIndex += 1) {
    const part = sourceParts[partIndex];
    if (part === ':path*') {
      if (partIndex !== sourceParts.length - 1) {
        return null;
      }
      captures.path = valueParts.slice(valueIndex).join('/');
      valueIndex = valueParts.length;
      continue;
    }

    if (part.startsWith(':')) {
      if (valueIndex >= valueParts.length) {
        return null;
      }
      captures[part.slice(1)] = valueParts[valueIndex];
      valueIndex += 1;
      continue;
    }

    if (valueParts[valueIndex] !== part) {
      return null;
    }
    valueIndex += 1;
  }

  if (valueIndex !== valueParts.length) {
    return null;
  }

  return captures;
}

function substitutePattern({ pattern, captures }: { pattern: string; captures: Record<string, string> }): string | null {
  const parts = splitPattern({ pattern });
  const output: string[] = [];

  for (const part of parts) {
    if (part === ':path*') {
      const value = captures.path ?? '';
      if (value) {
        output.push(...value.split('/').filter(Boolean));
      }
      continue;
    }

    if (part.startsWith(':')) {
      const value = captures[part.slice(1)];
      if (value === undefined) {
        return null;
      }
      output.push(value);
      continue;
    }

    output.push(part);
  }

  return output.join('/');
}

function applyRewriteRule({ fullSlug, rule }: { fullSlug: string; rule: RewriteRule }): string | null {
  const captures = matchSource({ source: rule.source, fullSlug });
  if (!captures) {
    return null;
  }
  return substitutePattern({ pattern: rule.destination, captures });
}

export function applyRewrites({
  fullSlug,
  rules = [],
}: {
  fullSlug: string;
  rules?: readonly RewriteRule[];
}): string {
  for (const rule of rules) {
    const rewritten = applyRewriteRule({ fullSlug, rule });
    if (rewritten !== null) {
      return toPublicSlug({ fullSlug: rewritten });
    }
  }
  return toPublicSlug({ fullSlug });
}

function matchingRuleIndex({ fullSlug, rules }: { fullSlug: string; rules: readonly RewriteRule[] }): number {
  const index = rules.findIndex((rule) => applyRewriteRule({ fullSlug, rule }) !== null);
  return index === -1 ? rules.length : index;
}

export function reverseRewriteRule({
  publicSlug,
  rule,
}: {
  publicSlug: string;
  rule: RewriteRule;
}): string | null {
  const destinationPattern = rule.destination.replace(/^\//, '');
  const captures = matchSource({ source: destinationPattern, fullSlug: publicSlug });
  if (!captures) {
    return null;
  }
  return substitutePattern({ pattern: rule.source, captures });
}

export function listRewriteCandidateFullSlugs({
  publicSlug,
  rules = [],
}: {
  publicSlug: string;
  rules?: readonly RewriteRule[];
}): string[] {
  const guesses = publicSlug === INDEX_SLUG ? [INDEX_SLUG, ''] : [publicSlug];
  const candidates: string[] = [];

  for (const rule of rules) {
    for (const guess of guesses) {
      const reversed = reverseRewriteRule({ publicSlug: guess, rule });
      if (reversed) {
        candidates.push(reversed);
      }
    }
  }

  return uniqueStrings(candidates);
}

export function listVaultFullSlugCandidates({
  slugOrId,
  wpSlug,
  rules = [],
}: {
  slugOrId: string;
  wpSlug?: string;
  rules?: readonly RewriteRule[];
}): string[] {
  const raw = slugOrId.replace(/^\//, '');
  const publicGuesses = uniqueStrings([
    wpSlug,
    wpSlug?.replace(/-/g, '/'),
    applyRewrites({ fullSlug: raw, rules }),
    toPublicSlug({ fullSlug: raw }),
    raw.replace(/-/g, '/'),
    raw,
  ]);

  const candidates: string[] = [];
  for (const guess of publicGuesses) {
    candidates.push(...listRewriteCandidateFullSlugs({ publicSlug: guess, rules }));
  }
  candidates.push(...publicGuesses);
  candidates.push(raw, raw.replace(/-/g, '/'));
  if (wpSlug) {
    candidates.push(wpSlug, wpSlug.replace(/-/g, '/'));
  }

  return uniqueStrings(candidates);
}

export function hyphenateSlug({ slug }: { slug: string }): string {
  return slug.replace(/\//g, '-');
}

export function derivePublicDirectories({ routes }: { routes: Record<string, string> }): string[] {
  const directories = new Set<string>();
  for (const publicSlug of Object.keys(routes)) {
    if (publicSlug === INDEX_SLUG) {
      continue;
    }
    const segments = publicSlug.split('/').filter(Boolean);
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join('/'));
    }
  }
  return [...directories].sort();
}

export function findPublicSlugForFullSlug({
  routes,
  fullSlug,
}: {
  routes: Record<string, string>;
  fullSlug: string;
}): string | undefined {
  const match = Object.entries(routes).find(([, routeFullSlug]) => routeFullSlug === fullSlug);
  return match?.[0];
}

export function isRouteWinner({
  routes,
  publicSlug,
  fullSlug,
}: {
  routes: Record<string, string>;
  publicSlug: string;
  fullSlug: string;
}): boolean {
  return routes[publicSlug] === fullSlug;
}

export function hasVaultRoutes({ routes }: { routes?: Record<string, string> }): boolean {
  return Boolean(routes && Object.keys(routes).length > 0);
}

export function buildRouteTable({
  fullSlugs,
  rules = [],
}: {
  fullSlugs: readonly string[];
  rules?: readonly RewriteRule[];
}): RouteTable {
  const ranked = fullSlugs.map((fullSlug) => ({
    fullSlug,
    publicSlug: applyRewrites({ fullSlug, rules }),
    ruleIndex: matchingRuleIndex({ fullSlug, rules }),
  }));

  ranked.sort((left, right) => {
    if (left.ruleIndex !== right.ruleIndex) {
      return left.ruleIndex - right.ruleIndex;
    }
    return left.fullSlug.localeCompare(right.fullSlug);
  });

  const routes: Record<string, string> = {};
  const publicSlugByFullSlug: Record<string, string> = {};
  const shadows: { publicSlug: string; winnerFullSlug: string; shadowedFullSlug: string }[] = [];

  for (const entry of ranked) {
    publicSlugByFullSlug[entry.fullSlug] = entry.publicSlug;
    const winner = routes[entry.publicSlug];
    if (winner) {
      shadows.push({
        publicSlug: entry.publicSlug,
        winnerFullSlug: winner,
        shadowedFullSlug: entry.fullSlug,
      });
      continue;
    }
    routes[entry.publicSlug] = entry.fullSlug;
  }

  return {
    routes,
    publicSlugByFullSlug,
    publicDirectories: derivePublicDirectories({ routes }),
    shadows,
  };
}
