import { describe, expect, it, vi } from "vitest";
import { createMarkdownRenderer, type MarkdownNode, preprocessWikilinks } from "./markdown";

describe("createMarkdownRenderer", () => {
  it("injects responsive image attributes into image nodes before processing", async () => {
    const renderer = createMarkdownRenderer({
      getResponsiveImageAttributes: vi.fn(() => ({
        src: "/image.png",
        srcSet: "/_thumbnails/image-320.webp 320w",
        sizes: "100vw",
      })),
      processMarkdown: async () => "rendered",
    });
    const tree: MarkdownNode = {
      type: "root",
      children: [
        {
          type: "image",
          url: "image.png",
        },
      ],
    };

    renderer.applyResponsiveImages({ tree, thumbnailSizes: [320] });

    expect(tree.children?.[0].data?.hProperties).toEqual({
      src: "/image.png",
      srcset: "/_thumbnails/image-320.webp 320w",
      sizes: "100vw",
      loading: "lazy",
      decoding: "async",
    });
    await expect(renderer.renderMarkdownContent({ markdown: "![alt](image.png)", thumbnailSizes: [320] })).resolves.toBe("rendered");
  });
});

describe("preprocessWikilinks", () => {
  it("converts Obsidian wikilinks to standard markdown image tags using publicFiles", () => {
    const markdown = "Hello ![[screenshot.png]] and ![[screenshot.png|My Alt Text]]";
    const publicFiles = ["attachments/screenshot.png"];
    const result = preprocessWikilinks(markdown, publicFiles);
    expect(result).toBe("Hello ![](</attachments/screenshot.png>) and ![My Alt Text](</attachments/screenshot.png>)");
  });
});

