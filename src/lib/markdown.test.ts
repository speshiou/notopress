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
      style: "max-width: 100%;",
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
      assetFiles: ["image.png"],
    });
    expect(html).toContain('<figure class="image-figure">');
    expect(html).toContain('<img src="/image.png" style="max-width: 100%;" alt="My Alt Text"');
    expect(html).toContain('<figcaption>My Alt Text</figcaption></figure>');
  });

  it("resolves standard markdown image references through known asset files", async () => {
    const { renderMarkdownContent } = await import("./markdown");
    const html = await renderMarkdownContent({
      markdown: "![Cable status](/Pasted%20image%2020260630150256.png)",
      thumbnailSizes: [320],
      assetFiles: ["attachments/Pasted image 20260630150256.png"],
    });

    expect(html).toContain('src="/attachments/Pasted%20image%2020260630150256.png"');
    expect(html).toContain('srcset="/_thumbnails/attachments/Pasted%20image%2020260630150256-320.webp 320w"');
  });

  it("renders GitHub-Flavored Markdown tables inside generic figures", async () => {
    const { renderMarkdownContent } = await import("./markdown");
    const html = await renderMarkdownContent({
      markdown: [
        "| VPN 品牌 | 裝置限制 |",
        "| :--- | :---: |",
        "| **[NordVPN](https://example.com/nord)** | 10 台裝置 |",
      ].join("\n"),
      thumbnailSizes: [320],
    });

    expect(html).toContain("<figure>\n<table>");
    expect(html).toContain("<table>");
    expect(html).toContain("</table>\n</figure>");
    expect(html).not.toContain("wp-block-table");
    expect(html).toContain("<th align=\"left\">VPN 品牌</th>");
    expect(html).toContain("<td align=\"center\">10 台裝置</td>");
    expect(html).toContain("<strong><a href=\"https://example.com/nord\">NordVPN</a></strong>");
  });

  it("applies custom table figure properties when provided", async () => {
    const { renderMarkdownContent } = await import("./markdown");
    const html = await renderMarkdownContent({
      markdown: [
        "| Name | Value |",
        "| --- | --- |",
        "| A | B |",
      ].join("\n"),
      thumbnailSizes: [320],
      getTableFigureProperties: () => ({ class: 'custom-table', style: 'overflow-x: auto;' }),
    });

    expect(html).toContain('<figure class="custom-table" style="overflow-x: auto;">');
  });

  it("consumes adjacent italicized paragraph as a table figcaption", async () => {
    const { renderMarkdownContent } = await import("./markdown");
    const html = await renderMarkdownContent({
      markdown: [
        "| Feature | Basic | Pro |",
        "| --- | --- | --- |",
        "| Export | Yes | Yes |",
        "",
        "*Feature comparison table.*",
      ].join("\n"),
      thumbnailSizes: [320],
      getTableFigureProperties: () => ({ class: 'wp-block-table is-style-stripes' }),
    });

    expect(html).toContain('<figure class="wp-block-table is-style-stripes">');
    expect(html).toContain('<figcaption>Feature comparison table.</figcaption>');
    expect(html).not.toContain('<p><em>Feature comparison table.</em></p>');
  });

  it("leaves preceding italicized paragraphs as normal text before tables", async () => {
    const { renderMarkdownContent } = await import("./markdown");
    const html = await renderMarkdownContent({
      markdown: [
        "*Feature comparison table.*",
        "",
        "| Feature | Basic | Pro |",
        "| --- | --- | --- |",
        "| Export | Yes | Yes |",
      ].join("\n"),
      thumbnailSizes: [320],
      getTableFigureProperties: () => ({ class: 'wp-block-table is-style-stripes' }),
    });

    expect(html).toContain('<figure class="wp-block-table is-style-stripes">');
    expect(html).toContain('<p><em>Feature comparison table.</em></p>');
    expect(html).not.toContain('<figcaption>Feature comparison table.</figcaption>');
  });

  it("does not wrap tables already inside figures with long attributes", async () => {
    const { wrapTablesInFigures } = await import("./markdown");
    const figureClass = "wp-block-table is-style-stripes has-fixed-layout alignwide custom-long-class-name";
    const html = `<figure class="${figureClass}" data-description="this attribute is intentionally long enough to exceed the old lookbehind window"><table><tbody><tr><td>A</td></tr></tbody></table></figure>`;

    expect(wrapTablesInFigures(html, () => ({ class: "wp-block-table" }))).toBe(html);
  });

  it("separates block-level images from adjacent text blocks", async () => {
    const { renderMarkdownContent } = await import("./markdown");
    const html = await renderMarkdownContent({
      markdown: "Some text before\n![My Alt Text](image.png)\nSome text after",
      thumbnailSizes: [320],
      assetFiles: ["image.png"],
    });
    expect(html).toContain("<p>Some text before</p>");
    expect(html).toContain('<figure class="image-figure">');
    expect(html).toContain('<img src="/image.png" style="max-width: 100%;" alt="My Alt Text"');
    expect(html).toContain("<p>Some text after</p>");
  });

  it("renders images with surrounding whitespace or newlines inside paragraphs wrapped in figure", async () => {
    const { renderMarkdownContent } = await import("./markdown");
    const html = await renderMarkdownContent({
      markdown: "  ![My Alt Text](image.png) \n ",
      thumbnailSizes: [320],
      assetFiles: ["image.png"],
    });
    expect(html).toContain('<figure class="image-figure">');
    expect(html).toContain('<img src="/image.png" style="max-width: 100%;" alt="My Alt Text"');
    expect(html).toContain('<figcaption>My Alt Text</figcaption></figure>');
  });

  it("consumes adjacent italicized paragraph as a custom figcaption and preserves links", async () => {
    const { renderMarkdownContent } = await import("./markdown");
    const html = await renderMarkdownContent({
      markdown: "![My Alt Text](image.png)\n*This is my [caption link](https://example.com) text.*",
      thumbnailSizes: [320],
      assetFiles: ["image.png"],
    });
    expect(html).toContain('<figure class="image-figure">');
    expect(html).toContain('<img src="/image.png" style="max-width: 100%;" alt="My Alt Text"');
    expect(html).toContain('<figcaption>This is my <a href="https://example.com">caption link</a> text.</figcaption></figure>');
    expect(html).not.toContain('<p><em>This is my');
  });
});

describe("preprocessWikilinks", () => {
  it("converts Obsidian wikilinks to standard markdown image tags using available asset files", () => {
    const markdown = "Hello ![[screenshot.png]] and ![[screenshot.png|My Alt Text]]";
    const assetFiles = ["attachments/screenshot.png"];
    const result = preprocessWikilinks(markdown, assetFiles);
    expect(result).toBe("Hello ![](</attachments/screenshot.png>) and ![My Alt Text](</attachments/screenshot.png>)");
  });

  it("converts note wikilinks to Markdown links using note titles", () => {
    const result = preprocessWikilinks("Read [[vpn-promotion-for-games]].", [], [
      {
        fullSlug: "vpn-promotion-for-games",
        title: "Best VPN Promotions for Games",
        href: "/vpn-promotion-for-games",
      },
    ]);

    expect(result).toBe("Read [Best VPN Promotions for Games](/vpn-promotion-for-games).");
  });

  it("keeps nested note paths when rendering wikilink URLs", () => {
    const result = preprocessWikilinks("Read [[gaming/vpn-promotion-for-games]].", [], [
      {
        fullSlug: "gaming/vpn-promotion-for-games",
        title: "Best VPN Promotions for Games",
        href: "/gaming/vpn-promotion-for-games",
      },
    ]);

    expect(result).toBe("Read [Best VPN Promotions for Games](/gaming/vpn-promotion-for-games).");
  });

  it("renders note embeds as content without adding the embedded note title", () => {
    const result = preprocessWikilinks("Before\n![[vpn-promotion-for-games]]\nAfter", [], [
      {
        fullSlug: "vpn-promotion-for-games",
        title: "Best VPN Promotions for Games",
        href: "/vpn-promotion-for-games",
        content: "This is the promotion body.",
      },
    ]);

    expect(result).toBe("Before\n\n\nThis is the promotion body.\n\n\nAfter");
  });

  it("recursively renders note embeds and note links inside embedded note content", () => {
    const result = preprocessWikilinks("Before\n![[first-embed]]\nAfter", [], [
      {
        fullSlug: "first-embed",
        title: "First Embed",
        href: "/first-embed",
        content: "First body.\n\n![[second-embed]]\n\n[[linked-note]]",
      },
      {
        fullSlug: "second-embed",
        title: "Second Embed",
        href: "/second-embed",
        content: "Second body.",
      },
      {
        fullSlug: "linked-note",
        title: "Linked Note",
        href: "/linked-note",
      },
    ]);

    expect(result).toContain("Before");
    expect(result).toContain("First body.");
    expect(result).toContain("Second body.");
    expect(result).toContain("[Linked Note](/linked-note)");
    expect(result).toContain("After");
    expect(result).not.toContain("[[");
    expect(result.indexOf("First body.")).toBeLessThan(result.indexOf("Second body."));
    expect(result.indexOf("Second body.")).toBeLessThan(result.indexOf("[Linked Note](/linked-note)"));
  });

  it("does not render private include notes as normal links", () => {
    const result = preprocessWikilinks("Embed ![[promo-note]] but keep [[promo-note]].", [], [
      {
        fullSlug: "promo-note",
        title: "Promo Note",
        href: "/promo-note",
        content: "Private promo body.",
        linkable: false,
      },
    ]);

    expect(result).toContain("Private promo body.");
    expect(result).toContain("[[promo-note]]");
    expect(result).not.toContain("[Promo Note](/promo-note)");
  });
});
