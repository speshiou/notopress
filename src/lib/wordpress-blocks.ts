type WordPressBlockAttributes = Record<string, string | number | boolean>;

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
  blockName: string;
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

function getAttributeValue({ html, name }: { html: string; name: string }): string | null {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i");
  const match = pattern.exec(html);
  return match ? match[2] : null;
}

function getBlockClassName(html: string, baseClassName: string): string | null {
  const classValue = getAttributeValue({ html, name: "class" });
  if (!classValue) {
    return null;
  }

  const blockClasses = classValue
    .split(/\s+/)
    .map((className) => className.trim())
    .filter((className) => className.length > 0 && className !== baseClassName);

  return blockClasses.length > 0 ? blockClasses.join(" ") : null;
}

function findElementEnd({ html, startIndex, tagName }: { html: string; startIndex: number; tagName: string }): number {
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
  const className = getBlockClassName(html, "wp-block-table");
  const attributes: WordPressBlockAttributes = className ? { className } : {};
  return wrapWordPressBlock({ blockName: "table", html, attributes });
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
    return wrapWordPressBlock({ blockName: "image", html });
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
    return wrapWordPressBlock({ blockName: "quote", html });
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
