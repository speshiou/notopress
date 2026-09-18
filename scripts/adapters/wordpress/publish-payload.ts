import { computeContentHash } from '../../core/state/sync-state';
import type { ContentTaxonomies } from '../../../src/domain/content-metadata';
import type { WordPressTaxonomyPayload } from './taxonomies';

export type WordPressPublishIntent = {
  title: string;
  content: string;
  slug: string;
  status: 'publish';
  taxonomies: ContentTaxonomies;
};

export type WordPressPublishPayload = {
  title: string;
  content: string;
  slug: string;
  status: 'publish';
  categories?: readonly number[];
  tags?: readonly number[];
};

export type WordPressPublishContentType = 'post' | 'page';

export function computeWordPressPayloadHash({
  contentType,
  intent,
}: {
  contentType: WordPressPublishContentType;
  intent: WordPressPublishIntent;
}): string {
  const canonicalPayload = JSON.stringify({
    contentType,
    title: intent.title,
    content: intent.content,
    slug: intent.slug,
    status: intent.status,
    categories: intent.taxonomies.categories ?? null,
    tags: intent.taxonomies.tags ?? null,
  });

  return computeContentHash(canonicalPayload);
}

export function computeResolvedWordPressPayloadHash({
  contentType,
  payload,
}: {
  contentType: WordPressPublishContentType;
  payload: WordPressPublishPayload;
}): string {
  return computeContentHash(JSON.stringify({
    contentType,
    title: payload.title,
    content: payload.content,
    slug: payload.slug,
    status: payload.status,
    categories: payload.categories ?? null,
    tags: payload.tags ?? null,
  }));
}

export function createWordPressPublishPayload({
  intent,
  taxonomyPayload,
}: {
  intent: WordPressPublishIntent;
  taxonomyPayload: WordPressTaxonomyPayload;
}): WordPressPublishPayload {
  return {
    title: intent.title,
    content: intent.content,
    slug: intent.slug,
    status: intent.status,
    ...taxonomyPayload,
  };
}
