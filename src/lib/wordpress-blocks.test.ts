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
    expect(result).toContain("<!-- wp:image -->");
    expect(result).toContain('<figure class="wp-block-image"><img src="/image.png" alt="Image"></figure>');
  });

  it("does not let top-level void tags consume following blocks", () => {
    const result = serializeHtmlToWordPressBlocks('<img src="/image.png"><p>After image</p>');

    expect(result).toContain('<!-- wp:html -->\n<img src="/image.png">\n<!-- /wp:html -->');
    expect(result).toContain("<!-- wp:paragraph -->\n<p>After image</p>\n<!-- /wp:paragraph -->");
  });

  it("reads table block classes only from the top-level figure", () => {
    const result = serializeHtmlToWordPressBlocks(
      '<figure><table><tbody><tr><td><span class="is-style-stripes">Nested</span></td></tr></tbody></table></figure>'
    );

    expect(result).toContain("<!-- wp:table -->");
    expect(result).not.toContain('"className":"is-style-stripes"');
  });
});
