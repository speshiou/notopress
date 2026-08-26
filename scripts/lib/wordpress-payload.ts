import { computeContentHash } from './sync-state';

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
  payload,
}: {
  contentType: WordPressPublishContentType;
  payload: WordPressPublishPayload;
}): string {
  const canonicalPayload = JSON.stringify({
    contentType,
    title: payload.title,
    content: payload.content,
    slug: payload.slug,
    status: payload.status,
    categories: payload.categories ?? null,
    tags: payload.tags ?? null,
  });

  return computeContentHash(canonicalPayload);
}
