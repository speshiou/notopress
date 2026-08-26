import { describe, expect, it } from 'vitest';
import { computeWordPressPayloadHash } from './wordpress-payload';

describe('computeWordPressPayloadHash', () => {
  const payload = {
    title: 'Post title',
    content: '<!-- wp:paragraph --><p>Body</p><!-- /wp:paragraph -->',
    slug: 'post-title',
    status: 'publish' as const,
    categories: [12],
    tags: [34, 56],
  };

  it('computes a deterministic hash for the complete publish payload', () => {
    expect(computeWordPressPayloadHash({ contentType: 'post', payload })).toBe(
      computeWordPressPayloadHash({ contentType: 'post', payload })
    );
  });

  it('changes when rendered output or publishing metadata changes', () => {
    const original = computeWordPressPayloadHash({ contentType: 'post', payload });

    expect(
      computeWordPressPayloadHash({
        contentType: 'post',
        payload: { ...payload, content: '<!-- wp:paragraph --><p>Changed</p><!-- /wp:paragraph -->' },
      })
    ).not.toBe(original);
    expect(computeWordPressPayloadHash({ contentType: 'page', payload })).not.toBe(original);
    expect(
      computeWordPressPayloadHash({ contentType: 'post', payload: { ...payload, tags: [34] } })
    ).not.toBe(original);
  });
});
