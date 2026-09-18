import { describe, expect, it } from 'vitest';
import { computeWordPressPayloadHash, createWordPressPublishPayload } from './publish-payload';

describe('WordPress publish intent', () => {
  const intent = {
    title: 'Post title',
    content: '<!-- wp:paragraph --><p>Body</p><!-- /wp:paragraph -->',
    slug: 'post-title',
    status: 'publish' as const,
    taxonomies: {
      categories: ['engineering'],
      tags: ['nextjs', 'publishing'],
    },
  };

  it('computes a deterministic hash for the target-independent intent', () => {
    expect(computeWordPressPayloadHash({ contentType: 'post', intent })).toBe(
      computeWordPressPayloadHash({ contentType: 'post', intent })
    );
  });

  it('changes when rendered output or publishing metadata changes', () => {
    const original = computeWordPressPayloadHash({ contentType: 'post', intent });

    expect(
      computeWordPressPayloadHash({
        contentType: 'post',
        intent: { ...intent, content: '<!-- wp:paragraph --><p>Changed</p><!-- /wp:paragraph -->' },
      })
    ).not.toBe(original);
    expect(computeWordPressPayloadHash({ contentType: 'page', intent })).not.toBe(original);
    expect(
      computeWordPressPayloadHash({
        contentType: 'post',
        intent: { ...intent, taxonomies: { ...intent.taxonomies, tags: ['nextjs'] } },
      })
    ).not.toBe(original);
  });

  it('resolves taxonomy IDs only when creating the REST payload', () => {
    expect(createWordPressPublishPayload({
      intent,
      taxonomyPayload: { categories: [12], tags: [34, 56] },
    })).toEqual({
      title: 'Post title',
      content: '<!-- wp:paragraph --><p>Body</p><!-- /wp:paragraph -->',
      slug: 'post-title',
      status: 'publish',
      categories: [12],
      tags: [34, 56],
    });
  });
});
