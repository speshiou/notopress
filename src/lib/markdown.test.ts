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

  it("renders standard markdown images as HTML wrapped in figure and figcaption", async () => {
    const { renderMarkdownContent } = await import("./markdown");
    const html = await renderMarkdownContent({
      markdown: "![My Alt Text](image.png)",
      thumbnailSizes: [320],
      publicFiles: ["image.png"],
    });
    expect(html).toContain('<figure class="image-figure">');
    expect(html).toContain('<img src="/image.png" alt="My Alt Text"');
    expect(html).toContain('<figcaption>My Alt Text</figcaption></figure>');
  });

  it("separates block-level images from adjacent text blocks", async () => {
    const { renderMarkdownContent } = await import("./markdown");
    const html = await renderMarkdownContent({
      markdown: "Some text before\n![My Alt Text](image.png)\nSome text after",
      thumbnailSizes: [320],
      publicFiles: ["image.png"],
    });
    expect(html).toContain("<p>Some text before</p>");
    expect(html).toContain('<figure class="image-figure">');
    expect(html).toContain('<img src="/image.png" alt="My Alt Text"');
    expect(html).toContain("<p>Some text after</p>");
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

