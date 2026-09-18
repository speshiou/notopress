import { describe, expect, it, vi } from 'vitest';
import { findWordPressPostIds, getWordPressPostId } from './remote-posts';

describe('findWordPressPostIds', () => {
  it('batches multiple slugs by WordPress resource type', async () => {
    const request = vi.fn(async () => [
      { id: 10, slug: 'first' },
      { id: 20, slug: 'second' },
    ]);
    const ids = await findWordPressPostIds({
      locators: [
        { restBase: 'posts', slug: 'first' },
        { restBase: 'posts', slug: 'second' },
      ],
      request,
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({
      path: expect.stringContaining('slug%5B%5D=first&slug%5B%5D=second'),
    });
    expect(getWordPressPostId({ ids, locator: { restBase: 'posts', slug: 'first' } })).toBe(10);
    expect(getWordPressPostId({ ids, locator: { restBase: 'posts', slug: 'second' } })).toBe(20);
  });

  it('keeps the compatible single-slug lookup shape', async () => {
    const request = vi.fn(async () => [{ id: 10 }]);
    const ids = await findWordPressPostIds({
      locators: [{ restBase: 'posts', slug: 'first' }],
      request,
    });

    expect(request).toHaveBeenCalledWith({ path: '/wp/v2/posts?slug=first&status=any' });
    expect(getWordPressPostId({ ids, locator: { restBase: 'posts', slug: 'first' } })).toBe(10);
  });
});
