import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveVaultRequest, fetchNoteReferencesForMarkdown, VaultConfig, VaultRootIndex, clearVaultCache } from "./vault";
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
    vi.mocked(s3.getFileFromS3).mockRejectedValueOnce(new Error("Rendered HTML not found")); // rendered page.html
    vi.mocked(s3.getFileFromS3).mockResolvedValueOnce("# Welcome Home"); // page.md

    const result = await resolveVaultRequest(mockConfig, []);

    expect(result?.type).toBe("markdown");
    if (result?.type === "markdown") {
      expect(result.metadata.title).toBe("Home");
      expect(result.content).toBe("# Welcome Home");
    }
    
    expect(s3.getFileFromS3).toHaveBeenCalledWith("test-bucket", "test-vault/root.json");
    expect(s3.getFileFromS3).toHaveBeenCalledWith("test-bucket", `test-vault/content/${INDEX_SLUG}.md`);
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

    expect(result?.type).toBe("markdown");
    if (result?.type === "markdown") {
      expect(result.renderedHtml).toBe("<p>Cached home</p>");
      expect(result.content).toBe("");
    }
    expect(s3.getFileFromS3).toHaveBeenCalledWith("test-bucket", "test-vault/_rendered/content/page.html");
  });

  it("should return null if root.json is missing", async () => {
    vi.mocked(s3.getFileFromS3).mockRejectedValue(new Error("Not found"));
    
    const result = await resolveVaultRequest(mockConfig, ["non-existent"]);
    expect(result).toBeNull();
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
      .mockResolvedValueOnce("# My Deep Post");            // blog/2024/my-post.md

    const result = await resolveVaultRequest(mockConfig, ["blog", "2024", "my-post"]);

    expect(result?.type).toBe("markdown");
    if (result?.type === "markdown") {
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
      .mockRejectedValueOnce(new Error("Rendered HTML not found"))
      .mockResolvedValueOnce("# Welcome to the Blog");

    const result = await resolveVaultRequest(mockConfig, ["blog"]);

    expect(result?.type).toBe("markdown");
    if (result?.type === "markdown") {
      expect(result.metadata.title).toBe("Blog Home");
      expect(result.content).toBe("# Welcome to the Blog");
    }
  });

  it("should resolve note links and embedded note content from nested directory indices", async () => {
    const mockRoot = {
      version: 1,
      pages: [{ title: "Root VPN", slug: "root-vpn", date: "2024-01-01", excerpt: "" }],
      directories: ["gaming"],
      publicFiles: [],
    };
    const mockGamingIndex = {
      version: 1,
      pages: [{ title: "Gaming VPN Promotion", slug: "vpn-promotion-for-games", date: "2024-01-02", excerpt: "" }],
    };

    vi.mocked(s3.getFileFromS3)
      .mockResolvedValueOnce(JSON.stringify(mockGamingIndex))
      .mockResolvedValueOnce(
        [
          "---",
          'title: "Gaming VPN Promotion"',
          "---",
          "# Gaming VPN Promotion",
          "",
          "Embedded body only.",
        ].join("\n")
      );

    const references = await fetchNoteReferencesForMarkdown({
      config: mockConfig,
      markdown: "Read [[root-vpn]] and embed ![[vpn-promotion-for-games]].",
      rootIndex: mockRoot,
    });

    expect(references).toContainEqual({
      fullSlug: "root-vpn",
      title: "Root VPN",
      href: "/root-vpn",
    });
    expect(references).toContainEqual({
      fullSlug: "gaming/vpn-promotion-for-games",
      title: "Gaming VPN Promotion",
      href: "/gaming/vpn-promotion-for-games",
      content: "Embedded body only.",
    });
    expect(s3.getFileFromS3).toHaveBeenCalledWith("test-bucket", "test-vault/content/gaming/index.json");
    expect(s3.getFileFromS3).toHaveBeenCalledWith(
      "test-bucket",
      "test-vault/content/gaming/vpn-promotion-for-games.md"
    );
  });

  it("should recursively resolve note links inside embedded note content", async () => {
    const mockRoot = {
      version: 1,
      pages: [
        { title: "First Embed", slug: "first-embed", date: "2024-01-01", excerpt: "" },
        { title: "Second Embed", slug: "second-embed", date: "2024-01-02", excerpt: "" },
        { title: "Linked Note", slug: "linked-note", date: "2024-01-03", excerpt: "" },
      ],
      directories: [],
      publicFiles: [],
    };

    vi.mocked(s3.getFileFromS3)
      .mockResolvedValueOnce(
        [
          "---",
          'title: "First Embed"',
          "---",
          "# First Embed",
          "",
          "First body.",
          "",
          "![[second-embed]]",
          "",
          "[[linked-note]]",
        ].join("\n")
      )
      .mockResolvedValueOnce(
        [
          "---",
          'title: "Second Embed"',
          "---",
          "# Second Embed",
          "",
          "Second body.",
        ].join("\n")
      );

    const references = await fetchNoteReferencesForMarkdown({
      config: mockConfig,
      markdown: "Main ![[first-embed]].",
      rootIndex: mockRoot,
    });

    expect(references).toContainEqual({
      fullSlug: "first-embed",
      title: "First Embed",
      href: "/first-embed",
      content: "First body.\n\n![[second-embed]]\n\n[[linked-note]]",
    });
    expect(references).toContainEqual({
      fullSlug: "second-embed",
      title: "Second Embed",
      href: "/second-embed",
      content: "Second body.",
    });
    expect(references).toContainEqual({
      fullSlug: "linked-note",
      title: "Linked Note",
      href: "/linked-note",
    });
  });

  it("should resolve private note includes for embeds without making them linkable", async () => {
    const privateIncludes: VaultRootIndex["noteIncludes"] = [
      {
        fullSlug: "vpn-promotion-for-games",
        title: "VPN Promotion",
        filePath: "_includes/vpn-promotion-for-games.md",
        linkable: false,
      },
    ];
    const mockRoot: VaultRootIndex = {
      version: 1,
      pages: [{ title: "Public Note", slug: "public-note", date: "2024-01-01", excerpt: "" }],
      directories: [],
      publicFiles: [],
      noteIncludes: privateIncludes,
    };

    vi.mocked(s3.getFileFromS3).mockResolvedValueOnce(
      [
        "---",
        'title: "VPN Promotion"',
        "---",
        "# VPN Promotion",
        "",
        "Private promotion body with [[public-note]].",
      ].join("\n")
    );

    const references = await fetchNoteReferencesForMarkdown({
      config: mockConfig,
      markdown: "Embed ![[vpn-promotion-for-games]] and link [[vpn-promotion-for-games]].",
      rootIndex: mockRoot,
    });

    expect(references).toContainEqual(expect.objectContaining({
      fullSlug: "vpn-promotion-for-games",
      title: "VPN Promotion",
      href: "/vpn-promotion-for-games",
      linkable: false,
      content: "Private promotion body with [[public-note]].",
    }));
    expect(references).toContainEqual({
      fullSlug: "public-note",
      title: "Public Note",
      href: "/public-note",
    });
    expect(s3.getFileFromS3).toHaveBeenCalledWith(
      "test-bucket",
      "test-vault/_includes/vpn-promotion-for-games.md"
    );
  });
});
