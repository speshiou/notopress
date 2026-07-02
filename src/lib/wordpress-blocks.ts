type WordPressBlockAttributes = Record<string, string | number | boolean>;
type WordPressBlockName = "code" | "heading" | "html" | "image" | "list" | "paragraph" | "quote" | "table";
type RootElementBlock = {
  blockName: WordPressBlockName;
  html: string;
  rootTagName: string;
  baseClassName: string;
  captionClassName?: string;
};

const VOID_HTML_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function serializeAttributes(attributes: WordPressBlockAttributes): string {
  const entries = Object.entries(attributes);
  if (entries.length === 0) {
    return "";
  }

  return ` ${JSON.stringify(attributes)}`;
}

function wrapWordPressBlock({
  blockName,
  html,
  attributes = {},
}: {
  blockName: WordPressBlockName;
  html: string;
  attributes?: WordPressBlockAttributes;
}): string {
  const serializedAttributes = serializeAttributes(attributes);
  return `<!-- wp:${blockName}${serializedAttributes} -->\n${html}\n<!-- /wp:${blockName} -->`;
}

function getOpeningTagName(html: string): string | null {
  const match = /^<\s*([a-zA-Z][\w:-]*)\b/.exec(html.trimStart());
  return match ? match[1].toLowerCase() : null;
}

function getOpeningTag(html: string): string | null {
  const match = /^<\s*[a-zA-Z][\w:-]*\b[^>]*>/.exec(html.trimStart());
  return match ? match[0] : null;
}

function getAttributeValue({ html, name }: { html: string; name: string }): string | null {
  const openingTag = getOpeningTag(html);
  if (!openingTag) {
    return null;
  }

  const pattern = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i");
  const match = pattern.exec(openingTag);
  return match ? match[2] : null;
}

function getBlockClassName({
  html,
  baseClassName,
  ignoredClassNames = [],
}: {
  html: string;
  baseClassName: string;
  ignoredClassNames?: readonly string[];
}): string | null {
  const classValue = getAttributeValue({ html, name: "class" });
  if (!classValue) {
    return null;
  }

  const ignoredClassNameSet = new Set([baseClassName, ...ignoredClassNames]);
  const blockClasses = classValue
    .split(/\s+/)
    .map((className) => className.trim())
    .filter((className) => className.length > 0 && !ignoredClassNameSet.has(className));

  return blockClasses.length > 0 ? blockClasses.join(" ") : null;
}

const WORDPRESS_CAPTION_CLASS = "wp-element-caption";
const WORDPRESS_IMAGE_CLASS = "wp-block-image";
const WORDPRESS_QUOTE_CLASS = "wp-block-quote";
const WORDPRESS_TABLE_CLASS = "wp-block-table";

function mergeClassNames({ existingClassName, classNames }: { existingClassName: string | null; classNames: readonly string[] }): string {
  const allClassNames = [
    ...classNames,
    ...(existingClassName || "").split(/\s+/),
  ]
    .map((className) => className.trim())
    .filter((className) => className.length > 0);

  return [...new Set(allClassNames)].join(" ");
}

function addClassToOpeningTag({ html, tagName, className }: { html: string; tagName: string; className: string }): string {
  const pattern = new RegExp(`^<${tagName}\\b([^>]*)>`, "i");
  const match = pattern.exec(html.trimStart());
  if (!match) {
    return html;
  }

  const openingTag = match[0];
  const existingClassName = getAttributeValue({ html, name: "class" });
  const mergedClassName = mergeClassNames({ existingClassName, classNames: [className] });
  const nextOpeningTag = existingClassName
    ? openingTag.replace(/\bclass\s*=\s*(["']).*?\1/i, `class="${mergedClassName}"`)
    : openingTag.replace(new RegExp(`^<${tagName}\\b`, "i"), `<${tagName} class="${mergedClassName}"`);

  return html.replace(openingTag, nextOpeningTag);
}

function addClassToElements({ html, tagName, className }: { html: string; tagName: string; className: string }): string {
  const pattern = new RegExp(`<${tagName}\\b([^>]*)>`, "gi");
  return html.replace(pattern, (openingTag: string) => {
    const classMatch = /\bclass\s*=\s*(["'])(.*?)\1/i.exec(openingTag);
    const mergedClassName = mergeClassNames({ existingClassName: classMatch ? classMatch[2] : null, classNames: [className] });
    if (classMatch) {
      return openingTag.replace(/\bclass\s*=\s*(["']).*?\1/i, `class="${mergedClassName}"`);
    }

    return openingTag.replace(new RegExp(`^<${tagName}\\b`, "i"), `<${tagName} class="${mergedClassName}"`);
  });
}

function stripAttributeFromElements({
  html,
  tagNames,
  attributeName,
}: {
  html: string;
  tagNames: readonly string[];
  attributeName: string;
}): string {
  const tagPattern = tagNames.join("|");
  const elementPattern = new RegExp(`<(${tagPattern})\\b[^>]*>`, "gi");
  const attributePattern = new RegExp(`\\s${attributeName}\\s*=\\s*(["']).*?\\1`, "i");

  return html.replace(elementPattern, (openingTag: string) => {
    return openingTag.replace(attributePattern, "");
  });
}

function stripAttributesFromElements({
  html,
  tagNames,
  attributeNames,
}: {
  html: string;
  tagNames: readonly string[];
  attributeNames: readonly string[];
}): string {
  return attributeNames.reduce(
    (currentHtml, attributeName) => stripAttributeFromElements({ html: currentHtml, tagNames, attributeName }),
    html
  );
}

function ensureImageAltAttribute(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (openingTag: string) => {
    if (/\salt\s*=/i.test(openingTag)) {
      return openingTag;
    }

    return openingTag.replace(/\s*\/?>$/, ' alt="">');
  });
}

function selfCloseImageTags(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (openingTag: string) => {
    if (/\/\s*>$/.test(openingTag)) {
      return openingTag;
    }

    return openingTag.replace(/\s*>$/, " />");
  });
}

function normalizeTableHtml(html: string): string {
  return stripAttributeFromElements({
    html: addClassToElements({ html, tagName: "table", className: "has-fixed-layout" }),
    tagNames: ["th", "td"],
    attributeName: "align",
  });
}

function normalizeImageHtml(html: string): string {
  const imageBlockHtml = addClassToOpeningTag({ html, tagName: "figure", className: WORDPRESS_IMAGE_CLASS });
  const largeImageHtml = addClassToOpeningTag({ html: imageBlockHtml, tagName: "figure", className: "size-large" });
  const withoutFigureStyle = stripAttributeFromElements({
    html: largeImageHtml,
    tagNames: ["figure"],
    attributeName: "style",
  });
  // The markdown/cache renderer may add runtime responsive attributes. Core
  // image block validation compares against saved block markup, so do not carry
  // those runtime-only img attributes into the WordPress post body.
  return stripAttributesFromElements({
    html: withoutFigureStyle,
    tagNames: ["img"],
    attributeNames: ["style", "srcset", "sizes", "loading", "decoding"],
  });
}

function getBlockAttributesFromClasses({
  html,
  baseClassName,
  ignoredClassNames,
}: {
  html: string;
  baseClassName: string;
  ignoredClassNames?: readonly string[];
}): WordPressBlockAttributes {
  const className = getBlockClassName({ html, baseClassName, ignoredClassNames });
  return className ? { className } : {};
}

function normalizeRootElementBlock({
  blockName,
  html,
  rootTagName,
  baseClassName,
  captionClassName,
}: RootElementBlock): string {
  const rootHtml = addClassToOpeningTag({ html, tagName: rootTagName, className: baseClassName });
  const normalizedHtml = captionClassName
    ? addClassToElements({ html: rootHtml, tagName: "figcaption", className: captionClassName })
    : rootHtml;

  return wrapWordPressBlock({
    blockName,
    html: normalizedHtml,
    attributes: getBlockAttributesFromClasses({ html: normalizedHtml, baseClassName }),
  });
}

function findElementEnd({ html, startIndex, tagName }: { html: string; startIndex: number; tagName: string }): number {
  const openingTagMatch = /^<\s*[a-zA-Z][\w:-]*\b[^>]*>/.exec(html.slice(startIndex));
  if (!openingTagMatch) {
    return startIndex + 1;
  }

  if (VOID_HTML_TAGS.has(tagName) || /\/\s*>$/.test(openingTagMatch[0])) {
    return startIndex + openingTagMatch[0].length;
  }

  const tagPattern = new RegExp(`<\\/?${tagName}\\b[^>]*>`, "gi");
  tagPattern.lastIndex = startIndex;

  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(html)) !== null) {
    const tag = match[0];
    const isClosingTag = /^<\s*\//.test(tag);
    const isSelfClosingTag = /\/\s*>$/.test(tag);

    if (isClosingTag) {
      depth -= 1;
      if (depth === 0) {
        return tagPattern.lastIndex;
      }
    } else if (!isSelfClosingTag) {
      depth += 1;
    }
  }

  return html.length;
}

function splitTopLevelHtml(html: string): string[] {
  const blocks: string[] = [];
  let cursor = 0;

  while (cursor < html.length) {
    const nextTagIndex = html.indexOf("<", cursor);
    if (nextTagIndex === -1) {
      const remainingText = html.slice(cursor).trim();
      if (remainingText.length > 0) {
        blocks.push(remainingText);
      }
      break;
    }

    const textBeforeTag = html.slice(cursor, nextTagIndex).trim();
    if (textBeforeTag.length > 0) {
      blocks.push(textBeforeTag);
    }

    if (html.startsWith("<!--", nextTagIndex)) {
      const commentEndIndex = html.indexOf("-->", nextTagIndex + 4);
      const endIndex = commentEndIndex === -1 ? html.length : commentEndIndex + 3;
      blocks.push(html.slice(nextTagIndex, endIndex).trim());
      cursor = endIndex;
      continue;
    }

    const tagMatch = /^<\s*([a-zA-Z][\w:-]*)\b[^>]*>/.exec(html.slice(nextTagIndex));
    if (!tagMatch) {
      const nextCharacterIndex = nextTagIndex + 1;
      blocks.push(html.slice(nextTagIndex, nextCharacterIndex));
      cursor = nextCharacterIndex;
      continue;
    }

    const tagName = tagMatch[1].toLowerCase();
    const endIndex = findElementEnd({ html, startIndex: nextTagIndex, tagName });
    blocks.push(html.slice(nextTagIndex, endIndex).trim());
    cursor = endIndex;
  }

  return blocks.filter((block) => block.length > 0);
}

function serializeTableBlock(html: string): string {
  return normalizeRootElementBlock({
    blockName: "table",
    html: normalizeTableHtml(html),
    rootTagName: "figure",
    baseClassName: WORDPRESS_TABLE_CLASS,
    captionClassName: WORDPRESS_CAPTION_CLASS,
  });
}

function serializeImageBlock(html: string): string {
  const withCaptionClass = addClassToElements({
    html: normalizeImageHtml(html),
    tagName: "figcaption",
    className: WORDPRESS_CAPTION_CLASS,
  });

  // After runtime attrs are removed, keep WordPress's expected img structure:
  // explicit empty alt for decorative/caption-only images and XHTML-style
  // self-closing syntax. Source markdown image syntax must not affect this shape.
  const normalizedHtml = selfCloseImageTags(ensureImageAltAttribute(withCaptionClass));

  return wrapWordPressBlock({
    blockName: "image",
    html: normalizedHtml,
    attributes: {
      sizeSlug: "large",
      linkDestination: "none",
      ...getBlockAttributesFromClasses({
        html: normalizedHtml,
        baseClassName: WORDPRESS_IMAGE_CLASS,
        ignoredClassNames: ["size-large"],
      }),
    },
  });
}

function serializeQuoteBlock(html: string): string {
  return normalizeRootElementBlock({
    blockName: "quote",
    html,
    rootTagName: "blockquote",
    baseClassName: WORDPRESS_QUOTE_CLASS,
  });
}

function serializeHeadingBlock({ html, tagName }: { html: string; tagName: string }): string {
  const level = Number.parseInt(tagName.replace("h", ""), 10);
  const attributes: WordPressBlockAttributes = level === 2 ? {} : { level };
  return wrapWordPressBlock({ blockName: "heading", html, attributes });
}

function serializeListBlock({ html, tagName }: { html: string; tagName: string }): string {
  const attributes: WordPressBlockAttributes = tagName === "ol" ? { ordered: true } : {};
  return wrapWordPressBlock({ blockName: "list", html, attributes });
}

function serializeKnownBlock(html: string): string {
  const tagName = getOpeningTagName(html);

  if (!tagName) {
    return wrapWordPressBlock({ blockName: "html", html });
  }

  if (tagName === "figure" && /<table\b/i.test(html)) {
    return serializeTableBlock(html);
  }

  if (tagName === "figure" && /<img\b/i.test(html)) {
    return serializeImageBlock(html);
  }

  if (tagName === "p") {
    return wrapWordPressBlock({ blockName: "paragraph", html });
  }

  if (/^h[1-6]$/.test(tagName)) {
    return serializeHeadingBlock({ html, tagName });
  }

  if (tagName === "ul" || tagName === "ol") {
    return serializeListBlock({ html, tagName });
  }

  if (tagName === "blockquote") {
    return serializeQuoteBlock(html);
  }

  if (tagName === "pre") {
    return wrapWordPressBlock({ blockName: "code", html });
  }

  return wrapWordPressBlock({ blockName: "html", html });
}

export function serializeHtmlToWordPressBlocks(html: string): string {
  return splitTopLevelHtml(html)
    .map(serializeKnownBlock)
    .join("\n\n");
}
