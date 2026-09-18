import { vi, describe, it, expect, beforeEach } from 'vitest';
import { publishToWordPress, restoreLocalImagePath, htmlToMarkdown, importFromWordPress } from './wordpress';
import { Site, Registry } from '../../../src/domain/registry';
import { VaultDirectoryIndex, VaultRootIndex } from '../../../src/lib/vault';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

import { readFile, readdir, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';

type MockDirectoryEntry = {
  name: string;
  isDirectory: () => boolean;
  isFile: () => boolean;
};

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
    vi.mocked(readFile).mockResolvedValue('# My Post Title\nThis is content.');
    global.fetch = vi.fn();
  });

  describe('htmlToMarkdown', () => {
    it('decodes collected WordPress media filenames for local Markdown references and downloads', () => {
      vi.mocked(existsSync).mockReturnValue(false);
      const collectedImages: { remoteUrl: string; tryHighResUrl: string; localPath: string }[] = [];

      const result = htmlToMarkdown(
        '<figure><img src="https://testsite.com/wp-content/uploads/2020/02/%E7%A4%BA%E4%BE%8B-image-1024x521.png" alt="" /></figure>',
        mockSite,
        mockRegistry,
        'article-map',
        collectedImages
      );

      expect(result).toContain('![](<article-map/示例-image.png>)');
      expect(collectedImages[0]?.localPath).toBe('/mock/vault/content/article-map/示例-image.png');
      expect(collectedImages[0]?.tryHighResUrl).toBe(
        'https://testsite.com/wp-content/uploads/2020/02/示例-image.png'
      );
    });
  });

  describe('publishToWordPress', () => {
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
    const mockRootOnlyIndices = new Map([...mockIndices].filter(([directory]) => directory === ''));

    it('does not apply the NotoPress route table to a targeted WordPress post', async () => {
      const rewrittenIndices = new Map<string, VaultDirectoryIndex>([
        [
          'guides',
          {
            version: 1,
            pages: [
              {
                title: 'Example Guide',
                slug: 'example-guide',
                publicSlug: 'docs/example-guide',
                date: '2026-06-16T13:00:00.000Z',
                excerpt: 'An example guide.',
              },
            ],
          },
        ],
      ]);
      const currentRootIndex: VaultRootIndex = {
        version: 1,
        pages: [],
        directories: ['guides'],
        publicFiles: [],
        assetFiles: [],
        routes: { 'docs/example-guide': 'guides/example-guide' },
        publicDirectories: ['docs'],
      };
      const mockFetch = vi.fn().mockImplementation(async (url, options) => {
        if (url.includes('/wp/v2/posts') && options.method === 'GET') {
          return { ok: true, json: async () => [{ id: 456, title: { rendered: 'Example Guide' } }] };
        }
        if (url.includes('/wp/v2/posts/456') && options.method === 'POST') {
          return { ok: true, json: async () => ({ id: 456 }) };
        }
        return { ok: false, status: 404 };
      });
      global.fetch = mockFetch;

      await publishToWordPress({
        site: mockSite,
        registry: mockRegistry,
        allIndices: rewrittenIndices,
        rootIndex: currentRootIndex,
        targetSlugs: ['guides/example-guide'],
        dryRun: false,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/wp/v2/posts?slug=example-guide'),
        expect.objectContaining({ method: 'GET' })
      );
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/wp/v2/posts?slug=docs-example-guide'),
        expect.objectContaining({ method: 'GET' })
      );
    });

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

      await publishToWordPress({
        site: mockSite,
        registry: mockRegistry,
        allIndices: mockIndices,
        targetSlugs: ['post-one'],
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

      const updateCall = mockFetch.mock.calls.find((call) => call[0].includes('/wp/v2/posts/456'));
      expect(updateCall).toBeDefined();
      const body = JSON.parse(updateCall![1].body);
      expect(body).not.toHaveProperty('date');
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

      await publishToWordPress({
        site: mockSite,
        registry: mockRegistry,
        allIndices: mockIndices,
        targetSlugs: ['blog/post-two'],
        dryRun: false,
      });

      // Assert lookup and create calls
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/wp/v2/posts?slug=post-two'),
        expect.objectContaining({ method: 'GET' })
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/wp/v2/posts'),
        expect.objectContaining({ method: 'POST' })
      );

      const createCall = mockFetch.mock.calls.find((call) => call[1]?.method === 'POST');
      expect(createCall).toBeDefined();
      const body = JSON.parse(createCall![1].body);
      expect(body.date).toBe('2026-06-16T13:00:00.000Z');
    });

    it('should publish content with nested wordpress.type page frontmatter to the pages endpoint', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url, options) => {
        if (url.includes('/wp/v2/pages') && options.method === 'GET') {
          return {
            ok: true,
            json: async () => [],
          };
        }
        if (url.includes('/wp/v2/pages') && options.method === 'POST') {
          return {
            ok: true,
            json: async () => ({ id: 321 }),
          };
        }
        return { ok: false, status: 404 };
      });
      global.fetch = mockFetch;
      vi.mocked(readFile).mockResolvedValue([
        '---',
        'title: "About"',
        'wordpress:',
        '  type: page',
        '---',
        '# About',
        '',
        'Page body.',
      ].join('\n'));

      await publishToWordPress({
        site: mockSite,
        registry: mockRegistry,
        allIndices: mockIndices,
        targetSlugs: ['post-one'],
        dryRun: false,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/wp/v2/pages?slug=post-one'),
        expect.objectContaining({ method: 'GET' })
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/wp/v2/pages'),
        expect.objectContaining({ method: 'POST' })
      );
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/wp/v2/posts'),
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should resolve optional category and tag slugs into the WordPress post payload', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url, options) => {
        if (url.includes('/wp/v2/categories?slug=engineering')) {
          return { ok: true, json: async () => [{ id: 12, slug: 'engineering' }] };
        }
        if (url.includes('/wp/v2/tags?slug=nextjs')) {
          return { ok: true, json: async () => [{ id: 34, slug: 'nextjs' }] };
        }
        if (url.includes('/wp/v2/tags?slug=publishing')) {
          return { ok: true, json: async () => [{ id: 56, slug: 'publishing' }] };
        }
        if (url.includes('/wp/v2/posts') && options.method === 'GET') {
          return { ok: true, json: async () => [] };
        }
        if (url.includes('/wp/v2/posts') && options.method === 'POST') {
          return { ok: true, json: async () => ({ id: 789 }) };
        }
        return { ok: false, status: 404 };
      });
      global.fetch = mockFetch;
      vi.mocked(readFile).mockResolvedValue([
        '---',
        'categories:',
        '  - engineering',
        'tags:',
        '  - nextjs',
        '  - publishing',
        '---',
        '# My Post Title',
        'Body.',
      ].join('\n'));

      await publishToWordPress({
        site: mockSite,
        registry: mockRegistry,
        allIndices: mockIndices,
        targetSlugs: ['post-one'],
        dryRun: false,
      });

      const postCall = mockFetch.mock.calls.find((call) => (
        call[0].includes('/wp/v2/posts') && call[1]?.method === 'POST'
      ));
      expect(postCall).toBeDefined();
      expect(JSON.parse(postCall![1].body)).toMatchObject({
        categories: [12],
        tags: [34, 56],
      });
    });

    it('should create missing taxonomy terms before publishing a post', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url, options) => {
        if (url.includes('/wp/v2/tags?slug=stock-analysis')) {
          return { ok: true, json: async () => [] };
        }
        if (url.endsWith('/wp/v2/tags') && options.method === 'POST') {
          return { ok: true, json: async () => ({ id: 78, slug: 'stock-analysis' }) };
        }
        if (url.includes('/wp/v2/posts') && options.method === 'GET') {
          return { ok: true, json: async () => [] };
        }
        if (url.includes('/wp/v2/posts') && options.method === 'POST') {
          return { ok: true, json: async () => ({ id: 789 }) };
        }
        return { ok: false, status: 404 };
      });
      global.fetch = mockFetch;
      vi.mocked(readFile).mockResolvedValue([
        '---',
        'tags:',
        '  - stock-analysis',
        '---',
        '# My Post Title',
        'Body.',
      ].join('\n'));

      await publishToWordPress({
        site: mockSite,
        registry: mockRegistry,
        allIndices: mockIndices,
        targetSlugs: ['post-one'],
        dryRun: false,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/wp/v2/tags'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'stock-analysis', slug: 'stock-analysis' }),
        })
      );
      const postCall = mockFetch.mock.calls.find((call) => (
        call[0].includes('/wp/v2/posts') && call[1]?.method === 'POST'
      ));
      expect(postCall).toBeDefined();
      expect(JSON.parse(postCall![1].body)).toMatchObject({ tags: [78] });
    });

    it('should omit optional taxonomy payload fields when frontmatter does not specify them', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url, options) => {
        if (url.includes('/wp/v2/posts') && options.method === 'GET') {
          return { ok: true, json: async () => [] };
        }
        if (url.includes('/wp/v2/posts') && options.method === 'POST') {
          return { ok: true, json: async () => ({ id: 789 }) };
        }
        return { ok: false, status: 404 };
      });
      global.fetch = mockFetch;

      await publishToWordPress({
        site: mockSite,
        registry: mockRegistry,
        allIndices: mockIndices,
        targetSlugs: ['post-one'],
        dryRun: false,
      });

      const postCall = mockFetch.mock.calls.find((call) => call[1]?.method === 'POST');
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1].body);
      expect(body).not.toHaveProperty('categories');
      expect(body).not.toHaveProperty('tags');
    });

    it('should publish markdown tables as striped WordPress table figures', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url, options) => {
        if (url.includes('/wp/v2/posts') && options.method === 'GET') {
          return {
            ok: true,
            json: async () => [],
          };
        }
        if (url.includes('/wp/v2/posts') && options.method === 'POST') {
          return {
            ok: true,
            json: async () => ({ id: 789 }),
          };
        }
        return { ok: false, status: 404 };
      });
      global.fetch = mockFetch;
      vi.mocked(readFile).mockResolvedValue([
        '# My Post Title',
        '',
        '| Name | Value |',
        '| --- | --- |',
        '| A | B |',
      ].join('\n'));

      await publishToWordPress({
        site: mockSite,
        registry: mockRegistry,
        allIndices: mockIndices,
        targetSlugs: ['post-one'],
        dryRun: false,
      });

      const postCall = mockFetch.mock.calls.find((call) => call[1]?.method === 'POST');
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1].body);
      expect(body.content).toContain('<!-- wp:table {"className":"is-style-stripes"} -->');
      expect(body.content).toContain('<figure class="wp-block-table is-style-stripes">');
      expect(body.content).toContain('<table class="has-fixed-layout">');
      expect(body.content).toContain('</table>\n</figure>');
      expect(body.content).toContain('<!-- /wp:table -->');
    });

    it('should publish angle-bracket and percent-encoded image paths as valid WordPress image blocks', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url, options) => {
        if (url.includes('/wp/v2/posts') && options.method === 'GET') {
          return {
            ok: true,
            json: async () => [],
          };
        }
        if (url.includes('/wp/v2/posts') && options.method === 'POST') {
          return {
            ok: true,
            json: async () => ({ id: 789 }),
          };
        }
        return { ok: false, status: 404 };
      });
      global.fetch = mockFetch;
      vi.mocked(readFile).mockImplementation(async (filePath) => {
        const normalizedPath = String(filePath);
        if (normalizedPath.endsWith('root.json')) {
          return JSON.stringify({
            publicFiles: [],
            contentFiles: ['hero image.png'],
          });
        }
        return [
          '# My Post Title',
          '',
          '![Angle-bracket caption](<hero image.png>)',
          '',
          '![Encoded caption](hero%20image.png)',
        ].join('\n');
      });

      await publishToWordPress({
        site: mockSite,
        registry: mockRegistry,
        allIndices: mockIndices,
        targetSlugs: ['post-one'],
        dryRun: false,
      });

      const postCall = mockFetch.mock.calls.find((call) => call[1]?.method === 'POST');
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1].body);
      expect(body.content).toContain('<!-- wp:image {"sizeSlug":"large","linkDestination":"none"} -->');
      expect(body.content).toContain('<figure class="size-large wp-block-image">');
      const expectedImageUrl = 'src="https://cdn.testsite.com/test-blog/content/_thumbnails/hero%20image-1200.webp"';
      expect(body.content.split(expectedImageUrl)).toHaveLength(3);
      expect(body.content).not.toContain('hero%2520image');
      expect(body.content).not.toContain('srcset=');
      expect(body.content).not.toContain('sizes=');
      expect(body.content).not.toContain('style="max-width: 100%;"');
      expect(body.content).not.toContain('loading=');
      expect(body.content).not.toContain('decoding=');
      expect(body.content).toContain('<figcaption class="wp-element-caption">Angle-bracket caption</figcaption>');
      expect(body.content).toContain('<figcaption class="wp-element-caption">Encoded caption</figcaption>');
      expect(body.content).toContain('<!-- /wp:image -->');
      expect(body.content).not.toContain('className":"wp-block-image');
    });

    it('should transclude private note includes before publishing to WordPress', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url, options) => {
        if (url.includes('/wp/v2/posts') && options.method === 'GET') {
          return {
            ok: true,
            json: async () => [],
          };
        }
        if (url.includes('/wp/v2/posts') && options.method === 'POST') {
          return {
            ok: true,
            json: async () => ({ id: 789 }),
          };
        }
        return { ok: false, status: 404 };
      });
      global.fetch = mockFetch;
      const mockedReaddir = vi.mocked(readdir) as unknown as {
        mockImplementation: (implementation: () => Promise<MockDirectoryEntry[]>) => void;
      };
      mockedReaddir.mockImplementation(async () => [
        {
          name: 'promo-note.md',
          isDirectory: () => false,
          isFile: () => true,
        },
      ]);
      vi.mocked(readFile).mockImplementation(async (filePath) => {
        if (filePath === '/mock/vault/content/post-one.md') {
          return [
            '---',
            'title: "Post One"',
            '---',
            '# Post One',
            '',
            'Before embed.',
            '',
            '![Hero](hero.png)',
            '',
            '![[promo-note]]',
          ].join('\n');
        }
        if (filePath === '/mock/vault/_includes/promo-note.md') {
          return [
            '---',
            'title: "Promo Note"',
            '---',
            '# Promo Note',
            '',
            'Embedded promotion body.',
          ].join('\n');
        }
        return '';
      });

      const indicesWithEmbed = new Map<string, VaultDirectoryIndex>([
        [
          '',
          {
            version: 1,
            pages: [
              { title: 'Post One', slug: 'post-one', date: '2026-06-16T12:00:00.000Z', excerpt: '' },
            ],
          },
        ],
      ]);

      await publishToWordPress({
        site: { ...mockSite, noteIncludePaths: ['_includes'] },
        registry: mockRegistry,
        allIndices: indicesWithEmbed,
        targetSlugs: ['post-one'],
        dryRun: false,
      });

      const postCall = mockFetch.mock.calls.find((call) => call[1]?.method === 'POST');
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1].body);

      expect(body.content).toContain('Embedded promotion body.');
      expect(body.content).toContain('<!-- wp:image {"sizeSlug":"large","linkDestination":"none"} -->');
      expect(body.content).toContain('<figure class="size-large wp-block-image">');
      expect(body.content).toContain('src="https://cdn.testsite.com/test-blog/content/_thumbnails/hero-1200.webp"');
      expect(body.content).not.toContain('srcset=');
      expect(body.content).not.toContain('sizes=');
      expect(body.content).not.toContain('![[promo-note]]');
      expect(body.content).not.toContain('Promo Note');
    });

    it('should require imageHost for WordPress publishing', async () => {
      await expect(
        publishToWordPress({
          site: { ...mockSite, imageHost: undefined },
          registry: { ...mockRegistry, imageHost: undefined },
          allIndices: mockIndices,
          targetSlugs: ['post-one'],
          dryRun: false,
        })
      ).rejects.toThrow('imageHost');
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

      await publishToWordPress({
        site: mockSite,
        registry: mockRegistry,
        allIndices: mockIndices,
        targetSlugs: ['post-one'],
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

    it('should reject a changed expected plan fingerprint before mutating WordPress', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url, options) => {
        if (url.includes('/wp/v2/posts') && options.method === 'GET') {
          return { ok: true, json: async () => [{ id: 456 }] };
        }
        return { ok: false, status: 404 };
      });
      global.fetch = mockFetch;

      await expect(publishToWordPress({
        site: mockSite,
        registry: mockRegistry,
        allIndices: mockIndices,
        targetSlugs: ['post-one'],
        expectedPlanFingerprint: 'reviewed-plan-fingerprint',
        dryRun: false,
      })).rejects.toThrow('WordPress publish plan changed');

      const postCalls = mockFetch.mock.calls.filter((call) => call[1]?.method === 'POST');
      expect(postCalls).toHaveLength(0);
    });

    it('should reject an update response that does not confirm the planned post ID', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url, options) => {
        if (url.includes('/wp/v2/posts') && options.method === 'GET') {
          return { ok: true, json: async () => [{ id: 456 }] };
        }
        if (url.includes('/wp/v2/posts/456') && options.method === 'POST') {
          return { ok: true, json: async () => ({ id: 999 }) };
        }
        return { ok: false, status: 404 };
      });
      global.fetch = mockFetch;

      await expect(publishToWordPress({
        site: mockSite,
        registry: mockRegistry,
        allIndices: mockIndices,
        targetSlugs: ['post-one'],
        dryRun: false,
      })).rejects.toThrow('invalid update response');
    });

    it('should not mutate any posts when a bulk publish plan is incomplete', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url, options) => {
        if (url.includes('slug=post-one') && options.method === 'GET') {
          throw new Error('lookup failed');
        }
        if (url.includes('/wp/v2/posts') && options.method === 'GET') {
          return { ok: true, json: async () => [] };
        }
        return { ok: true, json: async () => ({ id: 789 }) };
      });
      global.fetch = mockFetch;

      await expect(publishToWordPress({
        site: mockSite,
        registry: mockRegistry,
        allIndices: mockIndices,
        dryRun: false,
      })).rejects.toThrow('publish plan is incomplete');

      const postCalls = mockFetch.mock.calls.filter((call) => call[1]?.method === 'POST');
      expect(postCalls).toHaveLength(0);
    });

    it('should strip only the first H1 when it is the first non-empty line and outside code blocks', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url, options) => {
        if (url.includes('/wp/v2/posts') && options.method === 'GET') {
          return {
            ok: true,
            json: async () => [],
          };
        }
        if (url.includes('/wp/v2/posts') && options.method === 'POST') {
          return {
            ok: true,
            json: async () => ({ id: 789 }),
          };
        }
        return { ok: false, status: 404 };
      });
      global.fetch = mockFetch;

      // Mock markdown content with a code comment at the top, and a real title later
      vi.mocked(readFile).mockResolvedValue('```bash\n# This is a comment\necho "hello"\n```\n# Real Title\nThis is actual content.');

      await publishToWordPress({
        site: mockSite,
        registry: mockRegistry,
        allIndices: mockIndices,
        targetSlugs: ['post-one'],
        dryRun: false,
      });

      // Verify that the comment is kept and the title '# Real Title' is kept (not stripped, because there is content before it)
      const postCall = mockFetch.mock.calls.find((call) => call[1]?.method === 'POST');
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1].body);
      expect(body.content).toContain('# This is a comment');
      expect(body.content).toContain('<h1>Real Title</h1>');
    });

    it('should support multiple target slugs', async () => {
      const requestMethods: string[] = [];
      const mockFetch = vi.fn().mockImplementation(async (url, options) => {
        requestMethods.push(options.method);
        if (url.includes('/wp/v2/posts') && options.method === 'GET') {
          return {
            ok: true,
            json: async () => [],
          };
        }
        if (url.includes('/wp/v2/posts') && options.method === 'POST') {
          return {
            ok: true,
            json: async () => ({ id: 789 }),
          };
        }
        return { ok: false, status: 404 };
      });
      global.fetch = mockFetch;

      await publishToWordPress({
        site: mockSite,
        registry: mockRegistry,
        allIndices: mockIndices,
        targetSlugs: ['post-one', 'blog/post-two'],
        dryRun: false,
      });

      // Verify it queried both slug endpoints
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/wp/v2/posts?slug=post-one'),
        expect.objectContaining({ method: 'GET' })
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/wp/v2/posts?slug=post-two'),
        expect.objectContaining({ method: 'GET' })
      );
      // Verify two POST calls occurred
      const postCalls = mockFetch.mock.calls.filter((call) => call[1]?.method === 'POST');
      expect(postCalls.length).toBe(2);
      expect(requestMethods).toEqual(['GET', 'GET', 'POST', 'POST']);
    });

    it('should throw an error if none of the target slugs are found', async () => {
      await expect(
        publishToWordPress({
          site: mockSite,
          registry: mockRegistry,
          allIndices: mockIndices,
          targetSlugs: ['non-existent-slug'],
          dryRun: false,
        })
      ).rejects.toThrow('Could not find any posts in the vault matching slugs: "non-existent-slug"');
    });

    it('should warn but proceed if only a subset of slugs are missing', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url, options) => {
        if (url.includes('/wp/v2/posts') && options.method === 'GET') {
          return {
            ok: true,
            json: async () => [],
          };
        }
        if (url.includes('/wp/v2/posts') && options.method === 'POST') {
          return {
            ok: true,
            json: async () => ({ id: 789 }),
          };
        }
        return { ok: false, status: 404 };
      });
      global.fetch = mockFetch;
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await publishToWordPress({
        site: mockSite,
        registry: mockRegistry,
        allIndices: mockIndices,
        targetSlugs: ['post-one', 'non-existent-slug'],
        dryRun: false,
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not find posts in the vault matching slugs')
      );
      warnSpy.mockRestore();
    });

    it('should publish legacy entries once and then skip their unchanged final payload', async () => {
      const { computeContentHash } = await import('../../core/state/sync-state');
      const postContent = '# My Post Title\nThis is content.';
      const hash = computeContentHash(postContent);
      let savedSyncState = JSON.stringify({
        wordpress: {
          'post-one': { contentHash: hash, syncedAt: '2026-07-27T00:00:00.000Z' },
        },
      });

      vi.mocked(existsSync).mockImplementation((p) => String(p).endsWith('.notopress-sync.json'));
      vi.mocked(readFile).mockImplementation(async (p) => {
        if (String(p).endsWith('.notopress-sync.json')) {
          return savedSyncState;
        }
        return postContent;
      });
      vi.mocked(writeFile).mockImplementation(async (filePath, content) => {
        if (String(filePath).endsWith('.notopress-sync.json')) {
          savedSyncState = String(content);
        }
      });

      const mockFetch = vi.fn().mockImplementation(async (url, options) => {
        if (url.includes('/wp/v2/posts') && options.method === 'GET') {
          return { ok: true, json: async () => [{ id: 456 }] };
        }
        if (url.includes('/wp/v2/posts/456') && options.method === 'POST') {
          return { ok: true, json: async () => ({ id: 456 }) };
        }
        return { ok: false, status: 404 };
      });
      global.fetch = mockFetch;

      await publishToWordPress({
        site: mockSite,
        registry: mockRegistry,
        allIndices: mockRootOnlyIndices,
        dryRun: false,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/wp/v2/posts/456'),
        expect.objectContaining({ method: 'POST' })
      );
      expect(JSON.parse(savedSyncState).wordpress['post-one']).toEqual({
        contentHash: hash,
        payloadHash: expect.any(String),
        remoteId: 456,
        remoteSlug: 'post-one',
        contentType: 'post',
        syncedAt: expect.any(String),
      });

      mockFetch.mockClear();
      await publishToWordPress({
        site: mockSite,
        registry: mockRegistry,
        allIndices: mockRootOnlyIndices,
        dryRun: false,
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should reuse a cached remote post identity without a slug lookup', async () => {
      const postContent = '# My Post Title\nThis is content.';

      vi.mocked(existsSync).mockImplementation((path) => String(path).endsWith('.notopress-sync.json'));
      vi.mocked(readFile).mockImplementation(async (path) => {
        if (String(path).endsWith('.notopress-sync.json')) {
          return JSON.stringify({
            wordpress: {
              'post-one': {
                contentHash: 'previous-source-hash',
                payloadHash: 'previous-payload-hash',
                remoteId: 456,
                remoteSlug: 'post-one',
                contentType: 'post',
                syncedAt: '2026-07-27T00:00:00.000Z',
              },
            },
          });
        }
        return postContent;
      });

      const mockFetch = vi.fn().mockImplementation(async (url, options) => {
        if (url.includes('/wp/v2/posts/456') && options.method === 'POST') {
          return { ok: true, json: async () => ({ id: 456 }) };
        }
        return { ok: false, status: 404 };
      });
      global.fetch = mockFetch;

      await publishToWordPress({
        site: mockSite,
        registry: mockRegistry,
        allIndices: mockRootOnlyIndices,
        targetSlugs: ['post-one'],
        dryRun: false,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/wp/v2/posts/456'),
        expect.objectContaining({ method: 'POST' })
      );
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/wp/v2/posts?slug='),
        expect.anything()
      );
    });

    it('should republish when the final payload hash changes even if source markdown is unchanged', async () => {
      const { computeContentHash } = await import('../../core/state/sync-state');
      const postContent = '# My Post Title\nThis is content.';
      const sourceHash = computeContentHash(postContent);
      let savedSyncState = '';

      vi.mocked(existsSync).mockImplementation((filePath) => String(filePath).endsWith('.notopress-sync.json'));
      vi.mocked(readFile).mockImplementation(async (filePath) => {
        if (String(filePath).endsWith('.notopress-sync.json')) {
          return JSON.stringify({
            wordpress: {
              'post-one': {
                contentHash: sourceHash,
                payloadHash: 'stale-payload-hash',
                syncedAt: '2026-07-27T00:00:00.000Z',
              },
            },
          });
        }
        return postContent;
      });
      vi.mocked(writeFile).mockImplementation(async (filePath, content) => {
        if (String(filePath).endsWith('.notopress-sync.json')) {
          savedSyncState = String(content);
        }
      });

      const mockFetch = vi.fn().mockImplementation(async (url, options) => {
        if (url.includes('/wp/v2/posts') && options.method === 'GET') {
          return { ok: true, json: async () => [{ id: 456 }] };
        }
        if (url.includes('/wp/v2/posts/456') && options.method === 'POST') {
          return { ok: true, json: async () => ({ id: 456 }) };
        }
        return { ok: false, status: 404 };
      });
      global.fetch = mockFetch;

      await publishToWordPress({
        site: mockSite,
        registry: mockRegistry,
        allIndices: mockRootOnlyIndices,
        dryRun: false,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/wp/v2/posts/456'),
        expect.objectContaining({ method: 'POST' })
      );
      const savedEntry = JSON.parse(savedSyncState).wordpress['post-one'];
      expect(savedEntry.contentHash).toBe(sourceHash);
      expect(savedEntry.payloadHash).not.toBe('stale-payload-hash');
    });

    it('should push unchanged post when force is true', async () => {
      const { computeContentHash } = await import('../../core/state/sync-state');
      const postContent = '# My Post Title\nThis is content.';
      const hash = computeContentHash(postContent);

      vi.mocked(existsSync).mockImplementation((p) => String(p).endsWith('.notopress-sync.json'));
      vi.mocked(readFile).mockImplementation(async (p) => {
        if (String(p).endsWith('.notopress-sync.json')) {
          return JSON.stringify({
            wordpress: {
              'post-one': { contentHash: hash, syncedAt: '2026-07-27T00:00:00.000Z' },
            },
          });
        }
        return postContent;
      });

      const mockFetch = vi.fn().mockImplementation(async (url, options) => {
        if (url.includes('/wp/v2/posts') && options.method === 'GET') {
          return { ok: true, json: async () => [] };
        }
        if (url.includes('/wp/v2/posts') && options.method === 'POST') {
          return { ok: true, json: async () => ({ id: 789 }) };
        }
        return { ok: false, status: 404 };
      });
      global.fetch = mockFetch;

      await publishToWordPress({
        site: mockSite,
        registry: mockRegistry,
        allIndices: mockIndices,
        force: true,
        dryRun: false,
      });

      expect(mockFetch).toHaveBeenCalled();
    });

    it('initializes all publication state without calling the WordPress REST API', async () => {
      const writes: Record<string, string> = {};
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(readFile).mockResolvedValue('# Post content');
      vi.mocked(writeFile).mockImplementation(async (filePath, content) => {
        writes[String(filePath)] = String(content);
      });

      const mockFetch = vi.fn();
      global.fetch = mockFetch;

      await publishToWordPress({
        site: mockSite,
        registry: mockRegistry,
        allIndices: mockIndices,
        initializeState: true,
        dryRun: false,
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(writes['/mock/vault/.notopress-sync.json']).toBeDefined();
      const savedState = JSON.parse(writes['/mock/vault/.notopress-sync.json']);
      expect(savedState.wordpress['post-one']).toBeDefined();
      expect(savedState.wordpress['blog/post-two']).toBeDefined();
    });

    it('should not resolve taxonomies when marking posts as synced', async () => {
      const indicesWithTaxonomies = new Map<string, VaultDirectoryIndex>([
        ['', {
          version: 1,
          pages: [{
            title: 'Post One',
            slug: 'post-one',
            date: '2026-06-16T12:00:00.000Z',
            excerpt: 'An excerpt.',
            categories: ['engineering'],
            tags: ['publishing'],
          }],
        }],
      ]);
      global.fetch = vi.fn();

      await publishToWordPress({
        site: mockSite,
        registry: mockRegistry,
        allIndices: indicesWithTaxonomies,
        initializeState: true,
        dryRun: false,
      });

      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('restoreLocalImagePath', () => {
    it('should return simple relative paths unchanged', () => {
      const result = restoreLocalImagePath('/images/photo.png', mockSite, mockRegistry);
      expect(result).toBe('images/photo.png');
    });

    it('should resolve thumbnail CDN url to local relative path with correct original extension from disk', () => {
      // Mock existsSync to simulate file existing on disk
      vi.mocked(existsSync).mockImplementation((p) => {
        if (typeof p === 'string' && p.endsWith('/mock/vault/public/images/avatar.jpg')) {
          return true;
        }
        return false;
      });

      const result = restoreLocalImagePath(
        'https://cdn.testsite.com/test-blog/public/_thumbnails/images/avatar-640.webp',
        mockSite,
        mockRegistry
      );
      expect(result).toBe('images/avatar.jpg');
    });

    it('should resolve direct non-thumbnail image url and find original path on disk', () => {
      vi.mocked(existsSync).mockImplementation((p) => {
        if (typeof p === 'string' && p.endsWith('/mock/vault/content/docs/screenshot.png')) {
          return true;
        }
        return false;
      });

      const result = restoreLocalImagePath(
        '/api/vault-public/docs/screenshot.webp',
        mockSite,
        mockRegistry
      );
      expect(result).toBe('docs/screenshot.png');
    });

    it('should find decoded local filenames when thumbnail URLs contain encoded spaces', () => {
      vi.mocked(existsSync).mockImplementation((filePath) => (
        typeof filePath === 'string' &&
        filePath.endsWith('/mock/vault/content/post-one/Pasted image.webp')
      ));
      const collectedImages: { remoteUrl: string; tryHighResUrl: string; localPath: string }[] = [];

      const result = htmlToMarkdown(
        '<img src="https://cdn.testsite.com/test-blog/content/_thumbnails/attachments/Pasted%20image-1200.webp" alt="Image">',
        mockSite,
        mockRegistry,
        'post-one',
        collectedImages
      );

      expect(result).toBe('![Image](<post-one/Pasted image.webp>)');
      expect(collectedImages).toEqual([]);
    });
  });

  describe('htmlToMarkdown', () => {
    it('should parse basic html elements to markdown and decode HTML entities', () => {
      const html = '<p>Hello <strong>world</strong> and <em>everyone</em>! &#8211; &ldquo;Quotes&rdquo; &amp; &hellip;</p>';
      const md = htmlToMarkdown(html, mockSite, mockRegistry);
      expect(md).toBe('Hello **world** and *everyone*! – “Quotes” & …');
    });

    it('should parse headings', () => {
      const html = '<h1>Title 1</h1><h2>Title 2</h2><h3>Title 3</h3>';
      const md = htmlToMarkdown(html, mockSite, mockRegistry);
      expect(md).toBe('# Title 1\n\n## Title 2\n\n### Title 3');
    });

    it('should parse links and simple images', () => {
      const html = '<p>Link to <a href="https://google.com">Google</a> and <img src="/images/pic.png" alt="Pic" /></p>';
      const md = htmlToMarkdown(html, mockSite, mockRegistry);
      expect(md).toBe('Link to [Google](https://google.com) and ![Pic](<images/pic.png>)');
    });

    it('should parse code blocks and inline code', () => {
      const html = '<p>Use <code>const x = 5</code></p><pre class="wp-block-code"><code class="language-js">const y = 6;\nconsole.log(y);</code></pre>';
      const md = htmlToMarkdown(html, mockSite, mockRegistry);
      expect(md).toBe('Use `const x = 5`\n\n```js\nconst y = 6;\nconsole.log(y);\n```');
    });

    it('should parse blockquotes', () => {
      const html = '<blockquote><p>Quote text here.</p></blockquote>';
      const md = htmlToMarkdown(html, mockSite, mockRegistry);
      expect(md).toBe('> Quote text here.');
    });

    it('should parse nested unordered lists with correct indent', () => {
      const html = '<ul><li>Item 1</li><li>Item 2<ul><li>Subitem 1</li><li>Subitem 2</li></ul></li></ul>';
      const md = htmlToMarkdown(html, mockSite, mockRegistry);
      expect(md).toBe('- Item 1\n- Item 2\n  - Subitem 1\n  - Subitem 2');
    });

    it('should parse nested ordered lists with correct numbers', () => {
      const html = '<ol><li>One</li><li>Two<ol><li>Sub One</li><li>Sub Two</li></ol></li></ol>';
      const md = htmlToMarkdown(html, mockSite, mockRegistry);
      expect(md).toBe('1. One\n2. Two\n  1. Sub One\n  2. Sub Two');
    });

    it('should parse figures and figcaptions', () => {
      const html = '<figure class="wp-block-image"><img src="/images/fig.png" alt="Alt text" /><figcaption>Caption text</figcaption></figure>';
      const md = htmlToMarkdown(html, mockSite, mockRegistry);
      expect(md).toBe('![Alt text](<images/fig.png>)\n\n*Caption text*');
    });

    it('should parse figures with link inside figcaption', () => {
      const html = '<figure><img src="/images/fig.png" alt="Alt" /><figcaption>Source: <a href="http://google.com">Google</a></figcaption></figure>';
      const md = htmlToMarkdown(html, mockSite, mockRegistry);
      expect(md).toBe('![Alt](<images/fig.png>)\n\n*Source: [Google](http://google.com)*');
    });

    it('should parse HTML tables and captions into markdown tables', () => {
      const html = '<table><caption>List of codes</caption><thead><tr><th>Region</th><th>Code</th></tr></thead><tbody><tr><td>USA</td><td>+1</td></tr></tbody></table>';
      const md = htmlToMarkdown(html, mockSite, mockRegistry);
      expect(md).toBe('| Region | Code |\n| --- | --- |\n| USA | +1 |\n\n*List of codes*');
    });

    it('should parse Gutenberg table figures and figcaptions into contiguous markdown', () => {
      const html = '<figure class="wp-block-table"><table><thead><tr><th>Region</th><th>Code</th></tr></thead><tbody><tr><td>USA</td><td>+1</td></tr><tr><td>Taiwan</td><td>+886</td></tr></tbody></table><figcaption>Calling codes</figcaption></figure>';
      const md = htmlToMarkdown(html, mockSite, mockRegistry);

      expect(md).toBe('| Region | Code |\n| --- | --- |\n| USA | +1 |\n| Taiwan | +886 |\n\n*Calling codes*');
      expect(md).not.toContain('| --- | --- |\n\n|');
    });

    it('should collect each image destination once while preserving image captions', () => {
      vi.mocked(existsSync).mockReturnValue(false);
      const collectedImages: { remoteUrl: string; tryHighResUrl: string; localPath: string }[] = [];
      const html = '<figure><img src="https://cdn.testsite.com/test-blog/content/_thumbnails/image-1200.webp" alt="Alt"><figcaption>Caption</figcaption></figure>';

      const md = htmlToMarkdown(html, mockSite, mockRegistry, 'post-one', collectedImages);

      expect(md).toBe('![Alt](<post-one/image.webp>)\n\n*Caption*');
      expect(collectedImages).toHaveLength(1);
    });

    it('should strip comments and scripts from HTML content', () => {
      const html = '<!-- wp:paragraph --><p>Hello</p><script>console.log(123);</script>';
      const md = htmlToMarkdown(html, mockSite, mockRegistry);
      expect(md).toBe('Hello');
    });

    it('should preserve custom Block API v3 Gutenberg block comments in Markdown', () => {
      const html = '<p>Before</p>\n<!-- wp:namespace/example-block {"setting":"value"} /-->\n<p>After</p>';
      const md = htmlToMarkdown(html, mockSite, mockRegistry);
      expect(md).toContain('<!-- wp:namespace/example-block {"setting":"value"} /-->');
      expect(md).toContain('Before');
      expect(md).toContain('After');
    });
  });

  describe('importFromWordPress', () => {
    it('should pull a post by slug from wordpress, convert content, and write markdown file to the correct local path', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url, options) => {
        if (url.includes('/wp/v2/posts?slug=post-one') && options.method === 'GET') {
          return {
            ok: true,
            json: async () => [
              {
                id: 123,
                date: '2026-06-30T10:00:00',
                modified: '2026-06-30T11:00:00',
                slug: 'post-one',
                title: { rendered: 'Post One Title' },
                content: { rendered: '<p>WordPress body text.</p>' },
                status: 'publish',
              },
            ],
          };
        }
        return { ok: false, status: 404 };
      });
      global.fetch = mockFetch;

      await importFromWordPress({
        site: mockSite,
        registry: mockRegistry,
        slugOrId: 'post-one',
        dryRun: false,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/wp/v2/posts?slug=post-one&status=any&context=edit'),
        expect.objectContaining({ method: 'GET' })
      );

      // Verify that writeFile is called with the compiled markdown and correct path
      expect(mkdir).toHaveBeenCalledWith('/mock/vault/content', { recursive: true });
      expect(writeFile).toHaveBeenCalledWith(
        '/mock/vault/content/post-one.md',
        expect.stringContaining('title: "Post One Title"'),
        'utf-8'
      );
      expect(writeFile).toHaveBeenCalledWith(
        '/mock/vault/content/post-one.md',
        expect.not.stringContaining('# Post One Title'),
        'utf-8'
      );
      expect(writeFile).toHaveBeenCalledWith(
        '/mock/vault/content/post-one.md',
        expect.stringContaining('---\nWordPress body text.'),
        'utf-8'
      );
      expect(writeFile).toHaveBeenCalledWith(
        '/mock/vault/.notopress-sync.json',
        expect.stringContaining('post-one'),
        'utf-8'
      );
    });

    it('should pull WordPress categories and tags back into slug frontmatter', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url, options) => {
        if (url.includes('/wp/v2/posts?slug=post-one') && options.method === 'GET') {
          return {
            ok: true,
            json: async () => [{
              id: 123,
              date: '2026-06-30T10:00:00',
              modified: '2026-06-30T11:00:00',
              slug: 'post-one',
              title: { rendered: 'Post One Title' },
              content: { rendered: '<p>WordPress body text.</p>' },
              status: 'publish',
              categories: [12],
              tags: [34],
            }],
          };
        }
        if (url.includes('/wp/v2/categories?include=12')) {
          return { ok: true, json: async () => [{ id: 12, slug: 'engineering' }] };
        }
        if (url.includes('/wp/v2/tags?include=34')) {
          return { ok: true, json: async () => [{ id: 34, slug: 'nextjs' }] };
        }
        return { ok: false, status: 404 };
      });
      global.fetch = mockFetch;

      await importFromWordPress({
        site: mockSite,
        registry: mockRegistry,
        slugOrId: 'post-one',
        dryRun: false,
      });

      expect(writeFile).toHaveBeenCalledWith(
        '/mock/vault/content/post-one.md',
        expect.stringContaining('categories:\n  - "engineering"\ntags:\n  - "nextjs"'),
        'utf-8'
      );
    });

    it('should safely convert an edit-context raw block document with tables, captions, images, and custom blocks', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      const rawContent = [
        '<!-- wp:paragraph --><p>Intro</p><!-- /wp:paragraph -->',
        '<!-- wp:table --><figure class="wp-block-table"><table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>A</td><td>B</td></tr></tbody></table><figcaption>Comparison</figcaption></figure><!-- /wp:table -->',
        '<!-- wp:image --><figure class="wp-block-image"><img src="https://cdn.testsite.com/test-blog/content/_thumbnails/one-1200.webp" alt="One"><figcaption>First image</figcaption></figure><!-- /wp:image -->',
        '<!-- wp:image --><figure class="wp-block-image"><img src="https://cdn.testsite.com/test-blog/content/_thumbnails/two-1200.webp" alt="Two"></figure><!-- /wp:image -->',
        '<!-- wp:image --><figure class="wp-block-image"><img src="https://cdn.testsite.com/test-blog/content/_thumbnails/three-1200.webp" alt="Three"></figure><!-- /wp:image -->',
        '<!-- wp:namespace/example-block {"setting":"value"} /-->',
      ].join('\n');
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{
          id: 123,
          date: '2026-06-30T10:00:00',
          modified: '2026-06-30T11:00:00',
          slug: 'post-one',
          title: { raw: 'Post One Title', rendered: 'Post One Title' },
          content: { raw: rawContent, rendered: '<p>Rendered fallback should not be used.</p>' },
          status: 'publish',
        }],
      });
      global.fetch = mockFetch;
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      let output = '';

      try {
        await importFromWordPress({
          site: mockSite,
          registry: mockRegistry,
          slugOrId: 'post-one',
          dryRun: true,
        });
        output = log.mock.calls.flat().join('\n');
      } finally {
        log.mockRestore();
      }

      expect(output).toContain('| Name | Value |\n| --- | --- |\n| A | B |\n\n*Comparison*');
      expect(output).toContain('![One](<post-one/one.webp>)\n\n*First image*');
      expect(output).toContain('<!-- wp:namespace/example-block {"setting":"value"} /-->');
      expect(output).toContain('Would download 3 image(s)');
      expect(output).not.toContain('Rendered fallback should not be used.');
    });

    it('should fallback to target ID if slug fails', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url, options) => {
        if (url.includes('/wp/v2/posts?slug=123') && options.method === 'GET') {
          return {
            ok: true,
            json: async () => [],
          };
        }
        if (url.includes('/wp/v2/posts/123') && options.method === 'GET') {
          return {
            ok: true,
            json: async () => ({
              id: 123,
              date: '2026-06-30T10:00:00',
              modified: '2026-06-30T11:00:00',
              slug: 'pulled-post-slug',
              title: { rendered: 'Pulled Title' },
              content: { rendered: '<p>Fetched by ID.</p>' },
              status: 'publish',
            }),
          };
        }
        return { ok: false, status: 404 };
      });
      global.fetch = mockFetch;

      await importFromWordPress({
        site: mockSite,
        registry: mockRegistry,
        slugOrId: '123',
        dryRun: false,
      });

      expect(writeFile).toHaveBeenCalledWith(
        '/mock/vault/content/pulled-post-slug.md',
        expect.stringContaining('---\nFetched by ID.'),
        'utf-8'
      );
    });

    it('writes a rewritten post to the matching vault path instead of creating a root duplicate', async () => {
      vi.mocked(existsSync).mockImplementation((filePath) => filePath === '/mock/vault/content/guides/vpn.md');
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{
          id: 55,
          date: '2026-06-30T10:00:00',
          modified: '2026-06-30T11:00:00',
          slug: 'vpn',
          title: { rendered: 'VPN Guide' },
          content: { rendered: '<p>Body</p><img src="https://cdn.testsite.com/photo.png" alt="Photo">' },
          status: 'publish',
        }],
      });
      global.fetch = mockFetch;

      await importFromWordPress({
        site: {
          ...mockSite,
          rewrites: [{ source: 'guides/:path*', destination: '/:path*' }],
        },
        registry: mockRegistry,
        slugOrId: 'vpn',
        dryRun: false,
      });

      expect(writeFile).toHaveBeenCalledWith(
        '/mock/vault/content/guides/vpn.md',
        expect.stringContaining('title: "VPN Guide"'),
        'utf-8'
      );
      expect(writeFile).not.toHaveBeenCalledWith(
        '/mock/vault/content/vpn.md',
        expect.anything(),
        expect.anything()
      );
    });
  });
});
