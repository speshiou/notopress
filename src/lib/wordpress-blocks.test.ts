import { describe, expect, it } from "vitest";
import { serializeHtmlToWordPressBlocks } from "./wordpress-blocks";

describe("serializeHtmlToWordPressBlocks", () => {
  it("serializes top-level HTML into separate Gutenberg blocks", () => {
    const html = [
      "<h2>Overview</h2>",
      "<p>Hello <strong>world</strong>.</p>",
      '<figure class="wp-block-table is-style-stripes">',
      "<table><thead><tr><th>Name</th></tr></thead><tbody><tr><td>A</td></tr></tbody></table>",
      "</figure>",
    ].join("\n");

    const result = serializeHtmlToWordPressBlocks(html);

    expect(result).toContain("<!-- wp:heading -->\n<h2>Overview</h2>\n<!-- /wp:heading -->");
    expect(result).toContain("<!-- wp:paragraph -->\n<p>Hello <strong>world</strong>.</p>\n<!-- /wp:paragraph -->");
    expect(result).toContain('<!-- wp:table {"className":"is-style-stripes"} -->');
    expect(result).toContain('<figure class="wp-block-table is-style-stripes">');
    expect(result).toContain("<!-- /wp:table -->");
    expect(result.indexOf("<!-- /wp:paragraph -->")).toBeLessThan(result.indexOf("<!-- wp:table"));
  });

  it("keeps ordered lists and image figures as their own blocks", () => {
    const html = [
      "<ol><li>One</li><li>Two</li></ol>",
      '<figure class="wp-block-image"><img src="/image.png" alt="Image"></figure>',
    ].join("\n");

    const result = serializeHtmlToWordPressBlocks(html);

    expect(result).toContain('<!-- wp:list {"ordered":true} -->');
    expect(result).toContain("<ol><li>One</li><li>Two</li></ol>");
    expect(result).toContain('<!-- wp:image {"sizeSlug":"large","linkDestination":"none"} -->');
    expect(result).toContain('<figure class="size-large wp-block-image"><img src="/image.png" alt="Image" /></figure>');
  });

  it("normalizes image blocks to Gutenberg-compatible markup", () => {
    const result = serializeHtmlToWordPressBlocks(
      '<figure class="image-figure" style="height: auto !important;"><img src="/image.png" style="max-width: 100%;" srcset="/image-320.png 320w" sizes="100vw" loading="lazy" decoding="async" alt="Image"><figcaption>Image caption</figcaption></figure>'
    );

    expect(result).toContain('<!-- wp:image {"sizeSlug":"large","linkDestination":"none","className":"image-figure"} -->');
    expect(result).toContain('<figure class="size-large wp-block-image image-figure">');
    expect(result).toContain('<img src="/image.png" alt="Image" />');
    expect(result).toContain('<figcaption class="wp-element-caption">Image caption</figcaption>');
    expect(result).not.toContain('style="height: auto !important;"');
    expect(result).not.toContain('style="max-width: 100%;"');
    expect(result).not.toContain('srcset=');
    expect(result).not.toContain('sizes=');
    expect(result).not.toContain('loading=');
    expect(result).not.toContain('decoding=');
  });

  it("normalizes quote blocks to Gutenberg-compatible markup", () => {
    const result = serializeHtmlToWordPressBlocks("<blockquote><p>Quote text here.</p></blockquote>");

    expect(result).toContain("<!-- wp:quote -->");
    expect(result).toContain('<blockquote class="wp-block-quote"><p>Quote text here.</p></blockquote>');
  });

  it("keeps extra quote classes in block attributes", () => {
    const result = serializeHtmlToWordPressBlocks('<blockquote class="is-style-large"><p>Quote text here.</p></blockquote>');

    expect(result).toContain('<!-- wp:quote {"className":"is-style-large"} -->');
    expect(result).toContain('<blockquote class="wp-block-quote is-style-large"><p>Quote text here.</p></blockquote>');
  });

  it("normalizes table captions to Gutenberg-compatible markup", () => {
    const result = serializeHtmlToWordPressBlocks(
      '<figure class="wp-block-table is-style-stripes"><table><thead><tr><th align="left">Name</th></tr></thead><tbody><tr><td align="left">A</td></tr></tbody></table><figcaption>Feature comparison table.</figcaption></figure>'
    );

    expect(result).toContain('<!-- wp:table {"className":"is-style-stripes"} -->');
    expect(result).toContain('<table class="has-fixed-layout">');
    expect(result).not.toContain(' align="left"');
    expect(result).toContain('<figcaption class="wp-element-caption">Feature comparison table.</figcaption>');
  });

  it("does not duplicate WordPress block classes during normalization", () => {
    const result = serializeHtmlToWordPressBlocks(
      '<figure class="wp-block-image"><img src="/image.png" alt="Image"><figcaption class="wp-element-caption">Image caption</figcaption></figure>'
    );

    expect(result).toContain('<!-- wp:image {"sizeSlug":"large","linkDestination":"none"} -->');
    expect(result).toContain('<figure class="size-large wp-block-image">');
    expect(result).toContain('<figcaption class="wp-element-caption">Image caption</figcaption>');
    expect(result).not.toContain("wp-block-image wp-block-image");
    expect(result).not.toContain("wp-element-caption wp-element-caption");
  });

  it("does not let top-level void tags consume following blocks", () => {
    const result = serializeHtmlToWordPressBlocks('<img src="/image.png"><p>After image</p>');

    expect(result).toContain('<!-- wp:html -->\n<img src="/image.png">\n<!-- /wp:html -->');
    expect(result).toContain("<!-- wp:paragraph -->\n<p>After image</p>\n<!-- /wp:paragraph -->");
  });

  it("adds empty alt text and self-closes image tags for WordPress validation", () => {
    const result = serializeHtmlToWordPressBlocks(
      '<figure class="wp-block-image"><img src="/zelda-map.webp"><figcaption>Map caption</figcaption></figure>'
    );

    expect(result).toContain('<!-- wp:image {"sizeSlug":"large","linkDestination":"none"} -->');
    expect(result).toContain('<figure class="size-large wp-block-image"><img src="/zelda-map.webp" alt="" /><figcaption class="wp-element-caption">Map caption</figcaption></figure>');
  });

  it("normalizes existing self-closed image tags to WordPress spacing", () => {
    const result = serializeHtmlToWordPressBlocks(
      '<figure class="wp-block-image"><img src="/image.png" alt="Image"/></figure>'
    );

    expect(result).toContain('<figure class="size-large wp-block-image"><img src="/image.png" alt="Image" /></figure>');
    expect(result).not.toContain('alt="Image"/>');
  });

  it("reads table block classes only from the top-level figure", () => {
    const result = serializeHtmlToWordPressBlocks(
      '<figure><table><tbody><tr><td><span class="is-style-stripes">Nested</span></td></tr></tbody></table></figure>'
    );

    expect(result).toContain("<!-- wp:table -->");
    expect(result).not.toContain('"className":"is-style-stripes"');
  });
});
