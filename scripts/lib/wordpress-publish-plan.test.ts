import { describe, expect, it } from 'vitest';
import {
  createWordPressPublishPlan,
  formatWordPressPublishPlan,
  type WordPressPublishOperation,
} from './wordpress-publish-plan';

function createOperation(
  overrides: Partial<WordPressPublishOperation> = {}
): WordPressPublishOperation {
  return {
    action: 'update',
    sourceSlug: 'guides/example-guide',
    wordpressSlug: 'example-guide',
    title: 'Example Guide',
    date: '2026-06-16T13:00:00.000Z',
    contentType: 'post',
    restBase: 'posts',
    existingPostId: 456,
    sourceHash: 'source-hash',
    payloadHash: 'payload-hash',
    payload: {
      title: 'Example Guide',
      content: '<!-- wp:paragraph --><p>Body</p><!-- /wp:paragraph -->',
      slug: 'example-guide',
      status: 'publish',
    },
    ...overrides,
  };
}

describe('createWordPressPublishPlan', () => {
  it('creates a deterministic fingerprint for the same ordered operations', () => {
    const first = createWordPressPublishPlan({ operations: [createOperation()] });
    const second = createWordPressPublishPlan({ operations: [createOperation()] });

    expect(first.fingerprint).toBe(second.fingerprint);
  });

  it('changes the fingerprint when a planned target changes', () => {
    const first = createWordPressPublishPlan({ operations: [createOperation()] });
    const second = createWordPressPublishPlan({
      operations: [createOperation({ existingPostId: 789 })],
    });

    expect(first.fingerprint).not.toBe(second.fingerprint);
  });
});

describe('formatWordPressPublishPlan', () => {
  it('emits machine-readable operation metadata without logging rendered payload content', () => {
    const plan = createWordPressPublishPlan({ operations: [createOperation()] });
    const output = formatWordPressPublishPlan({ plan });
    const json = JSON.parse(output.slice(output.indexOf('{')));

    expect(json).toMatchObject({
      version: 1,
      fingerprint: plan.fingerprint,
      operations: [{
        action: 'update',
        sourceSlug: 'guides/example-guide',
        wordpressSlug: 'example-guide',
        existingPostId: 456,
        payloadHash: 'payload-hash',
      }],
    });
    expect(output).not.toContain('<!-- wp:paragraph -->');
  });
});
