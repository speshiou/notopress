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
});
