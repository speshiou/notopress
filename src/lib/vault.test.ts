import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveVaultRequest, VaultConfig, clearVaultCache } from "./vault";
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
    const mockRoot = {
      version: 1,
      pages: [{ title: "Home", slug: INDEX_SLUG, date: "2024-01-01", excerpt: "Hello" }],
      directories: [],
      publicFiles: [],
    };

    vi.mocked(s3.getFileFromS3).mockResolvedValueOnce(JSON.stringify(mockRoot)); // root.json
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
      .mockResolvedValueOnce("# Welcome to the Blog");

    const result = await resolveVaultRequest(mockConfig, ["blog"]);

    expect(result?.type).toBe("markdown");
    if (result?.type === "markdown") {
      expect(result.metadata.title).toBe("Blog Home");
      expect(result.content).toBe("# Welcome to the Blog");
    }
  });
});
