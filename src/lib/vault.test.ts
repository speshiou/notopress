import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveVaultRequest, VaultConfig, VaultRootIndex, clearVaultCache } from "./vault";
import * as s3 from "./s3";
import { INDEX_SLUG } from "./constants";

// Mock S3
vi.mock("./s3", () => ({
  getFileFromS3: vi.fn(),
}));

describe("Vault Resolution (Unit Tests)", () => {
  const mockConfig: VaultConfig = {
    bucketName: "test-bucket",
    vaultRoot: "test-vault",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clearVaultCache();
  });

  it("should resolve a root page correctly", async () => {
    // 1. Mock root.json
    const mockRoot: VaultRootIndex = {
      version: 1,
      pages: [{ title: "Home", slug: INDEX_SLUG, date: "2024-01-01", excerpt: "Hello" }],
      directories: [],
      publicFiles: [],
    };

    vi.mocked(s3.getFileFromS3).mockResolvedValueOnce(JSON.stringify(mockRoot)); // root.json
    vi.mocked(s3.getFileFromS3).mockResolvedValueOnce("<p>Welcome Home</p>");

    const result = await resolveVaultRequest(mockConfig, []);

    expect(result?.type).toBe("html");
    if (result?.type === "html") {
      expect(result.metadata.title).toBe("Home");
      expect(result.renderedHtml).toBe("<p>Welcome Home</p>");
    }
    
    expect(s3.getFileFromS3).toHaveBeenCalledWith("test-bucket", "test-vault/root.json");
    expect(s3.getFileFromS3).toHaveBeenCalledWith("test-bucket", `test-vault/_rendered/content/${INDEX_SLUG}.html`);
  });

  it("should attach cached rendered HTML when available", async () => {
    const mockRoot = {
      version: 1,
      pages: [{ title: "Home", slug: INDEX_SLUG, date: "2024-01-01", excerpt: "Hello" }],
      directories: [],
      publicFiles: [],
    };

    vi.mocked(s3.getFileFromS3)
      .mockResolvedValueOnce(JSON.stringify(mockRoot))
      .mockResolvedValueOnce("<p>Cached home</p>");

    const result = await resolveVaultRequest(mockConfig, []);

    expect(result?.type).toBe("html");
    if (result?.type === "html") {
      expect(result.renderedHtml).toBe("<p>Cached home</p>");
    }
    expect(s3.getFileFromS3).toHaveBeenCalledWith("test-bucket", "test-vault/_rendered/content/page.html");
  });

  it("should return null if root.json is missing", async () => {
    vi.mocked(s3.getFileFromS3).mockRejectedValue(new Error("Not found"));
    
    const result = await resolveVaultRequest(mockConfig, ["non-existent"]);
    expect(result).toBeNull();
  });

  it('does not request source Markdown when rendered HTML is missing', async () => {
    vi.mocked(s3.getFileFromS3).mockResolvedValueOnce(JSON.stringify({ version: 1, pages: [{ title: 'Example', slug: 'article', date: '2026-01-01', excerpt: '' }], directories: [], publicFiles: [] }))
      .mockRejectedValueOnce(new Error('Missing distribution'));
    expect(await resolveVaultRequest(mockConfig, ['article'])).toBeNull();
    expect(s3.getFileFromS3).toHaveBeenCalledTimes(2);
    expect(vi.mocked(s3.getFileFromS3).mock.calls.every(([, key]) => !key.endsWith('.md'))).toBe(true);
  });

  it('accepts an empty rendered article without invoking a fallback', async () => {
    vi.mocked(s3.getFileFromS3).mockResolvedValueOnce(JSON.stringify({ version: 1, pages: [{ title: 'Example', slug: 'article', date: '2026-01-01', excerpt: '' }], directories: [], publicFiles: [] }))
      .mockResolvedValueOnce('');
    expect(await resolveVaultRequest(mockConfig, ['article'])).toMatchObject({ type: 'html', renderedHtml: '' });
    expect(s3.getFileFromS3).toHaveBeenCalledTimes(2);
  });

  it("should handle nested directory jumps", async () => {
    // 1. Mock root.json with directories
    const mockRoot = {
      version: 1,
      pages: [],
      directories: ["blog/2024"],
      publicFiles: [],
    };

    // 2. Mock blog/2024/index.json
    const mockBlogIndex = {
      version: 1,
      pages: [{ title: "Deep Post", slug: "my-post", date: "2024-05-08", excerpt: "Deep" }],
    };

    vi.mocked(s3.getFileFromS3)
      .mockResolvedValueOnce(JSON.stringify(mockRoot))      // root.json
      .mockResolvedValueOnce(JSON.stringify(mockBlogIndex)) // blog/2024/index.json
      .mockResolvedValueOnce("<p>My Deep Post</p>");            // blog/2024/my-post.md

    const result = await resolveVaultRequest(mockConfig, ["blog", "2024", "my-post"]);

    expect(result?.type).toBe("html");
    if (result?.type === "html") {
      expect(result.metadata.title).toBe("Deep Post");
    }
  });

  it("should handle collection views", async () => {
    const mockRoot = {
      version: 1,
      pages: [],
      directories: ["blog"],
      publicFiles: [],
    };

    const mockBlogIndex = {
      version: 1,
      pages: [
        { title: "Post 1", slug: "post-1", date: "2024-01-01", excerpt: "One" },
        { title: "Post 2", slug: "post-2", date: "2024-01-02", excerpt: "Two" },
      ],
    };

    vi.mocked(s3.getFileFromS3)
      .mockResolvedValueOnce(JSON.stringify(mockRoot))
      .mockResolvedValueOnce(JSON.stringify(mockBlogIndex));

    const result = await resolveVaultRequest(mockConfig, ["blog"]);

    expect(result?.type).toBe("collection");
    if (result?.type === "collection") {
      expect(result.pages).toHaveLength(2);
      expect(result.pages[0].title).toBe("Post 1");
    }
  });

  it("should prioritize index page over collection view in a directory", async () => {
    const mockRoot = {
      version: 1,
      pages: [],
      directories: ["blog"],
      publicFiles: [],
    };

    const mockBlogIndex = {
      version: 1,
      pages: [
        { title: "Blog Home", slug: INDEX_SLUG, date: "2024-01-01", excerpt: "Home" },
        { title: "Other Post", slug: "other", date: "2024-01-02", excerpt: "Other" },
      ],
    };

    vi.mocked(s3.getFileFromS3)
      .mockResolvedValueOnce(JSON.stringify(mockRoot))
      .mockResolvedValueOnce(JSON.stringify(mockBlogIndex))
      .mockResolvedValueOnce("<p>Welcome to the Blog</p>");

    const result = await resolveVaultRequest(mockConfig, ["blog"]);

    expect(result?.type).toBe("html");
    if (result?.type === "html") {
      expect(result.metadata.title).toBe("Blog Home");
      expect(result.renderedHtml).toBe("<p>Welcome to the Blog</p>");
    }
  });

  it("resolves rewritten public slugs from the route map", async () => {
    const mockRoot: VaultRootIndex = {
      version: 1,
      pages: [{ title: "Home", slug: INDEX_SLUG, publicSlug: INDEX_SLUG, date: "2024-01-01", excerpt: "" }],
      directories: ["guides"],
      publicFiles: [],
      routes: {
        page: "page",
        vpn: "guides/vpn",
      },
      publicDirectories: [],
    };
    const mockGuidesIndex = {
      version: 1,
      pages: [{ title: "VPN", slug: "vpn", publicSlug: "vpn", date: "2024-01-02", excerpt: "" }],
    };

    vi.mocked(s3.getFileFromS3)
      .mockResolvedValueOnce(JSON.stringify(mockRoot))
      .mockResolvedValueOnce(JSON.stringify(mockGuidesIndex))
      .mockResolvedValueOnce("<p>VPN</p>");

    const result = await resolveVaultRequest(mockConfig, ["vpn"]);
    expect(result?.type).toBe("html");
    if (result?.type === "html") {
      expect(result.matchedSlug).toBe("guides/vpn");
      expect(result.metadata.title).toBe("VPN");
    }
  });

  it("redirects old vault paths to the rewritten public href", async () => {
    const mockRoot: VaultRootIndex = {
      version: 1,
      pages: [],
      directories: ["guides"],
      publicFiles: [],
      routes: {
        vpn: "guides/vpn",
      },
      publicDirectories: [],
    };

    vi.mocked(s3.getFileFromS3).mockResolvedValueOnce(JSON.stringify(mockRoot));

    const result = await resolveVaultRequest(mockConfig, ["guides", "vpn"]);
    expect(result).toEqual({ type: "redirect", href: "/vpn" });
  });

  it("does not expose flattened source directories as collections", async () => {
    const mockRoot: VaultRootIndex = {
      version: 1,
      pages: [],
      directories: ["guides"],
      publicFiles: [],
      routes: {
        vpn: "guides/vpn",
      },
      publicDirectories: [],
    };

    vi.mocked(s3.getFileFromS3).mockResolvedValueOnce(JSON.stringify(mockRoot));

    const result = await resolveVaultRequest(mockConfig, ["guides"]);
    expect(result).toBeNull();
  });
});
