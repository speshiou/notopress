import { vi, describe, it, expect, beforeEach } from 'vitest';
import { replaceLocalImagesWithThumbnails, pushToWordPress } from './wordpress';
import { Site, Registry } from '../../src/domain/registry';
import { VaultDirectoryIndex } from '../../src/lib/vault';

// Mock dependency modules
vi.mock('./files', () => ({
  getAssetSubDir: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
}));

// Access mocked functions
import { getAssetSubDir } from './files';
import { readFile, readdir } from 'fs/promises';

describe('WordPress Deployment Library', () => {
  const mockSite: Site = {
    siteId: 'test-blog',
    vaultPath: '/mock/vault',
    domain: 'testsite.com',
    imageHost: 'https://cdn.testsite.com',
    wordpress: {
      username: 'user123',
      applicationPassword: 'pwd-abc-xyz',
      endpoint: 'https://testsite.com/wp-json',
    },
    thumbnailSizes: [300, 600, 1200],
  };

  const mockRegistry: Registry = {
    sites: [mockSite],
    thumbnailSizes: [300, 600, 1200],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock implementation
    vi.mocked(getAssetSubDir).mockResolvedValue('content');
    vi.mocked(readFile).mockResolvedValue('# My Post Title\nThis is content.');
    global.fetch = vi.fn();
  });

  describe('replaceLocalImagesWithThumbnails', () => {
    it('should replace local image sources with absolute CDN URLs pointing to the largest thumbnail', async () => {
      const html = '<p>Hello world</p><img src="/images/pic.png" alt="Pic" />';
      const sizes = [300, 600, 1200];

      // Simulate that the file exists in the "content" directory
      vi.mocked(getAssetSubDir).mockResolvedValue('content');

      const result = await replaceLocalImagesWithThumbnails({
        html,
        site: mockSite,
        registry: mockRegistry,
        sizes,
      });

      expect(result).toContain(
        '<figure class="wp-block-image"><img src="https://cdn.testsite.com/test-blog/content/_thumbnails/images/pic-1200.webp" alt="Pic" /><figcaption>Pic</figcaption></figure>'
      );
    });

    it('should fallback to site domain if imageHost is not provided', async () => {
      const html = '<img src="/pic.png" alt="Direct" />';
      const sizes = [300, 600, 1200];

      const siteWithoutImageHost = { ...mockSite, imageHost: undefined };

      const result = await replaceLocalImagesWithThumbnails({
        html,
        site: siteWithoutImageHost,
        registry: { ...mockRegistry, imageHost: undefined },
        sizes,
      });

      expect(result).toContain(
        '<figure class="wp-block-image"><img src="https://testsite.com/api/vault-public/_thumbnails/pic-1200.webp" alt="Direct" /><figcaption>Direct</figcaption></figure>'
      );
    });

    it('should ignore external URLs and data URIs', async () => {
      const html = `
        <img src="https://external.com/photo.jpg" alt="Ext" />
        <img src="data:image/png;base64,abc" alt="Data" />
        <img src="#hash" alt="Hash" />
      `;
      const sizes = [300, 600, 1200];

      const result = await replaceLocalImagesWithThumbnails({
        html,
        site: mockSite,
        registry: mockRegistry,
        sizes,
      });

      expect(result).toContain('src="https://external.com/photo.jpg"');
      expect(result).toContain('src="data:image/png;base64,abc"');
      expect(result).toContain('src="#hash"');
    });
  });

  describe('pushToWordPress', () => {
    const mockIndices = new Map<string, VaultDirectoryIndex>([
      [
        '',
        {
          version: 1,
          pages: [
            {
              title: 'Post One',
              slug: 'post-one',
              date: '2026-06-16T12:00:00.000Z',
              excerpt: 'An excerpt.',
            },
          ],
        },
      ],
      [
        'blog',
        {
          version: 1,
          pages: [
            {
              title: 'Post Two',
              slug: 'post-two',
              date: '2026-06-16T13:00:00.000Z',
              excerpt: 'Another excerpt.',
            },
          ],
        },
      ],
    ]);

    it('should perform GET queries to check for existence and POST queries to update when the post exists', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url, options) => {
        // Query GET matches
        if (url.includes('/wp/v2/posts') && options.method === 'GET') {
          return {
            ok: true,
            json: async () => [{ id: 456, title: { rendered: 'Post One' } }],
          };
        }
        // Update POST matches
        if (url.includes('/wp/v2/posts/456') && options.method === 'POST') {
          return {
            ok: true,
            json: async () => ({ id: 456 }),
          };
        }
        return { ok: false, status: 404 };
      });
      global.fetch = mockFetch;

      await pushToWordPress({
        site: mockSite,
        registry: mockRegistry,
        allIndices: mockIndices,
        targetPostSlug: 'post-one',
        dryRun: false,
      });

      // Assert fetch calls
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/wp/v2/posts?slug=post-one'),
        expect.objectContaining({ method: 'GET' })
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/wp/v2/posts/456'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should perform GET queries and POST to create a new post when it does not exist', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url, options) => {
        // Query GET matches empty array
        if (url.includes('/wp/v2/posts') && options.method === 'GET') {
          return {
            ok: true,
            json: async () => [],
          };
        }
        // Create POST matches
        if (url.includes('/wp/v2/posts') && options.method === 'POST') {
          return {
            ok: true,
            json: async () => ({ id: 789 }),
          };
        }
        return { ok: false, status: 404 };
      });
      global.fetch = mockFetch;

      await pushToWordPress({
        site: mockSite,
        registry: mockRegistry,
        allIndices: mockIndices,
        targetPostSlug: 'blog/post-two',
        dryRun: false,
      });

      // Assert lookup and create calls
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/wp/v2/posts?slug=blog%2Fpost-two'),
        expect.objectContaining({ method: 'GET' })
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/wp/v2/posts'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should only query and perform no mutations when dryRun is true', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url, options) => {
        if (url.includes('/wp/v2/posts') && options.method === 'GET') {
          return {
            ok: true,
            json: async () => [],
          };
        }
        return { ok: false, status: 404 };
      });
      global.fetch = mockFetch;

      await pushToWordPress({
        site: mockSite,
        registry: mockRegistry,
        allIndices: mockIndices,
        targetPostSlug: 'post-one',
        dryRun: true,
      });

      // Verified GET was called
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/wp/v2/posts?slug=post-one'),
        expect.objectContaining({ method: 'GET' })
      );
      // Verify no POST methods were called
      const postCalls = mockFetch.mock.calls.filter((call) => call[1]?.method === 'POST');
      expect(postCalls.length).toBe(0);
    });
  });
});
