import { describe, expect, it, vi } from "vitest";
import { createMarkdownRenderer, type MarkdownNode, preprocessWikilinks } from "./markdown";
import { serializeHtmlToWordPressBlocks } from "./wordpress-blocks";

describe("createMarkdownRenderer", () => {
  it("injects responsive image attributes into image nodes before processing", async () => {
    const renderer = createMarkdownRenderer({
      getResponsiveImageAttributes: vi.fn(() => ({
        src: "/image.png",
        srcSet: "/_thumbnails/image-320.webp 320w",
        sizes: "100vw",
      })),
      getOriginalImageSrc: ({ src }) => src,
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
    expect(html).toContain('<img src="/api/vault-public/_thumbnails/image-320.webp" style="max-width: 100%;" alt="My Alt Text"');
    expect(html).toContain('<figcaption>My Alt Text</figcaption></figure>');
  });

  it("resolves standard markdown image references through known asset files", async () => {
    const { renderMarkdownContent } = await import("./markdown");
    const html = await renderMarkdownContent({
      markdown: "![Example alt](/Pasted%20image%20example.png)",
      thumbnailSizes: [320],
      assetFiles: ["attachments/Pasted image example.png"],
    });

    expect(html).toContain('src="/api/vault-public/_thumbnails/attachments/Pasted%20image%20example-320.webp"');
    expect(html).toContain('srcset="/api/vault-public/_thumbnails/attachments/Pasted%20image%20example-320.webp 320w"');
  });

  it("uses the generated widths recorded for each source asset", async () => {
    const { renderMarkdownContent } = await import("./markdown");
    const html = await renderMarkdownContent({
      markdown: "![Product](attachments/products/example.png)",
      thumbnailSizes: [320, 640, 960, 1280],
      assetFiles: ["attachments/products/example.png"],
      responsiveImageWidths: { "attachments/products/example.png": [128] },
    });

    expect(html).toContain('src="/api/vault-public/_thumbnails/attachments/products/example-128.webp"');
    expect(html).toContain('srcset="/api/vault-public/_thumbnails/attachments/products/example-128.webp 128w"');
    expect(html).toContain('sizes="(max-width: 128px) 100vw, 128px"');
    expect(html).not.toContain("-320.webp");
    expect(html).not.toContain("-640.webp");
    expect(html).not.toContain("-1280.webp");
  });

  it("uses the original absolute asset URL for GIFs without responsive thumbnails", async () => {
    const { renderMarkdownContent } = await import("./markdown");
    const html = await renderMarkdownContent({
      markdown: "![Animated status](attachments/status.gif)",
      thumbnailSizes: [320],
      assetFiles: ["attachments/status.gif"],
      assetUrlConfig: {
        imageHost: "https://cdn.example.com/",
        siteId: "example-site",
        s3SubDir: "content",
        mode: "absolute",
      },
    });

    expect(html).toContain('src="https://cdn.example.com/example-site/content/attachments/status.gif"');
    expect(html).not.toContain("srcset=");
    expect(html).not.toContain("_thumbnails");
  });

  it("uses the vault asset route for app-relative GIFs without responsive thumbnails", async () => {
    const { renderMarkdownContent } = await import("./markdown");
    const html = await renderMarkdownContent({
      markdown: "![Animated status](attachments/status.gif)",
      thumbnailSizes: [320],
      assetFiles: ["attachments/status.gif"],
      assetUrlConfig: {
        s3SubDir: "content",
        mode: "app-relative",
      },
    });

    expect(html).toContain('src="/api/vault-public/attachments/status.gif"');
    expect(html).not.toContain("srcset=");
    expect(html).not.toContain("_thumbnails");
  });

  it("renders GitHub-Flavored Markdown tables inside generic figures", async () => {
    const { renderMarkdownContent } = await import("./markdown");
    const html = await renderMarkdownContent({
      markdown: [
        "| Feature | Limit |",
        "| :--- | :---: |",
        "| **[Example](https://example.com/nord)** | 10 devices |",
      ].join("\n"),
      thumbnailSizes: [320],
    });

    expect(html).toContain("<figure>\n<table>");
    expect(html).toContain("<table>");
    expect(html).toContain("</table>\n</figure>");
    expect(html).not.toContain("wp-block-table");
    expect(html).toContain("<th align=\"left\">Feature</th>");
    expect(html).toContain("<td align=\"center\">10 devices</td>");
    expect(html).toContain("<strong><a href=\"https://example.com/nord\">Example</a></strong>");
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

  it("does not consume complex content after a table as a caption", async () => {
    const { renderMarkdownContent } = await import("./markdown");
    const html = await renderMarkdownContent({
      markdown: [
        "| Country | Code |",
        "| --- | --- |",
        "| Example | +1-555 |",
        "",
        "*Reminder:* prepare a note before leaving.",
        "",
        "| Service | Link |",
        "| --- | --- |",
        "| Example | [Deal](https://example.com) |",
        "",
        "*Service comparison table.*",
      ].join("\n"),
      thumbnailSizes: [320],
      getTableFigureProperties: () => ({ class: 'wp-block-table is-style-stripes' }),
    });

    expect(html).toContain('<p><em>Reminder:</em> prepare a note before leaving.</p>');
    expect(html).toContain('<figcaption>Service comparison table.</figcaption>');
    expect(html).not.toContain('<figcaption>Reminder:');
  });

  it("does not consume transcluded wikilink content after a table as a caption", async () => {
    const { renderMarkdownContent } = await import("./markdown");
    const html = await renderMarkdownContent({
      markdown: [
        "| Country | Code |",
        "| --- | --- |",
        "| Example | +1-555 |",
        "",
        "![[related-note]]",
      ].join("\n"),
      thumbnailSizes: [320],
      noteReferences: [
        {
          fullSlug: "related-note",
          title: "Related Note",
          href: "/related-note",
          content: [
            "*Reminder:* prepare a note before leaving.",
            "",
            "| Service | Link |",
            "| --- | --- |",
            "| Example | [Deal](https://example.com) |",
            "",
            "*Service comparison table.*",
          ].join("\n"),
        },
      ],
      getTableFigureProperties: () => ({ class: 'wp-block-table is-style-stripes' }),
    });

    expect(html).toContain('<p><em>Reminder:</em> prepare a note before leaving.</p>');
    expect(html).toContain('<figcaption>Service comparison table.</figcaption>');
    expect(html).not.toContain('<figcaption>Reminder:');
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
    expect(html).toContain('<img src="/api/vault-public/_thumbnails/image-320.webp" style="max-width: 100%;" alt="My Alt Text"');
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
    expect(html).toContain('<img src="/api/vault-public/_thumbnails/image-320.webp" style="max-width: 100%;" alt="My Alt Text"');
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
    expect(html).toContain('<img src="/api/vault-public/_thumbnails/image-320.webp" style="max-width: 100%;" alt="My Alt Text"');
    expect(html).toContain('<figcaption>This is my <a href="https://example.com">caption link</a> text.</figcaption></figure>');
    expect(html).not.toContain('<p><em>This is my');
  });

  it("renders markdown images and image wikilinks to the same cached HTML and WordPress image block", async () => {
    const { renderMarkdownContent } = await import("./markdown");
    const render = (markdown: string) => renderMarkdownContent({
      markdown,
      thumbnailSizes: [320],
      assetFiles: ["attachments/map.png"],
      getFigureProperties: () => ({ class: "wp-block-image", style: "height: auto !important;" }),
    });

    const markdownImageHtml = await render("![](attachments/map.png)\n*Map caption.*");
    const wikilinkImageHtml = await render("![[map.png]]\n*Map caption.*");

    expect(wikilinkImageHtml).toBe(markdownImageHtml);
    expect(markdownImageHtml).toContain('srcset="/api/vault-public/_thumbnails/attachments/map-320.webp 320w"');

    const markdownImageBlock = serializeHtmlToWordPressBlocks(markdownImageHtml);
    const wikilinkImageBlock = serializeHtmlToWordPressBlocks(wikilinkImageHtml);
    expect(wikilinkImageBlock).toBe(markdownImageBlock);
    expect(markdownImageBlock).toContain('<img src="/api/vault-public/_thumbnails/attachments/map-320.webp" alt="" />');
    expect(markdownImageBlock).not.toContain("srcset=");
  });
});

describe("preprocessWikilinks", () => {
  it("converts Obsidian wikilinks to standard markdown image tags using available asset files", () => {
    const markdown = "Hello ![[screenshot.png]] and ![[screenshot.png|My Alt Text]]";
    const assetFiles = ["attachments/screenshot.png"];
    const result = preprocessWikilinks(markdown, assetFiles);
    expect(result).toBe("Hello ![](</attachments/screenshot.png>) and ![My Alt Text](</attachments/screenshot.png>)");
  });

  it("converts path-prefixed image wikilinks using available asset files", () => {
    const result = preprocessWikilinks("Map ![[attachments/map.png|Map Alt]]", ["attachments/map.png"]);

    expect(result).toBe("Map ![Map Alt](</attachments/map.png>)");
  });

  it("converts note wikilinks to Markdown links using note titles", () => {
    const result = preprocessWikilinks("Read [[example-note]].", [], [
      {
        fullSlug: "example-note",
        title: "Example Note",
        href: "/example-note",
      },
    ]);

    expect(result).toBe("Read [Example Note](/example-note).");
  });

  it("keeps nested note paths when rendering wikilink URLs", () => {
    const result = preprocessWikilinks("Read [[guides/example-note]].", [], [
      {
        fullSlug: "guides/example-note",
        title: "Example Note",
        href: "/guides/example-note",
      },
    ]);

    expect(result).toBe("Read [Example Note](/guides/example-note).");
  });

  it("renders escaped table wikilinks alongside regular Markdown links", async () => {
    const { renderMarkdownContent } = await import("./markdown");
    const rendered = await renderMarkdownContent({
      markdown: [
        "| Type | Link |",
        "| --- | --- |",
        "| Wiki | [[note-slug\\|Display label]] |",
        "| Markdown | [Regular guide](https://example.com/guide) |",
      ].join("\n"),
      thumbnailSizes: [],
      noteReferences: [
        {
          fullSlug: "note-slug",
          title: "Note title",
          href: "/note-slug",
        },
      ],
    });

    expect(rendered).toContain('<a href="/note-slug">Display label</a>');
    expect(rendered).toContain('<a href="https://example.com/guide">Regular guide</a>');
    expect(rendered).not.toContain("[[");
  });

  it("renders note embeds as content without adding the embedded note title", () => {
    const result = preprocessWikilinks("Before\n![[example-note]]\nAfter", [], [
      {
        fullSlug: "example-note",
        title: "Example Note",
        href: "/example-note",
        content: "This is the embedded body.",
      },
    ]);

    expect(result).toBe("Before\n\n\nThis is the embedded body.\n\n\nAfter");
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
