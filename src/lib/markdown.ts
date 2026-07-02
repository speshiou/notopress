import { remark } from "remark";
import html from "remark-html";
import gfm from "remark-gfm";
import type { Plugin } from "unified";
import { getResponsiveImageAttributes, normalizeThumbnailSizes } from "./responsive-images";
import { resolveMarkdownImagePaths } from "./local-images";
import { createNoteReferenceResolver, parseWikilinkContent, type NoteReference } from "./note-links";

export type MarkdownNode = {
  type: "root" | "paragraph" | "image" | "image-figure" | "element" | "text" | "html" | (string & {});
  url?: string;
  alt?: string;
  title?: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, string | number | boolean>;
  data?: {
    hName?: string;
    hProperties?: Record<string, string | number | boolean>;
    hChildren?: MarkdownNode[];
  };
  children?: MarkdownNode[];
};

export type MarkdownRendererDeps = {
  getResponsiveImageAttributes: ({
    src,
    thumbnailSizes,
  }: {
    src: string;
    thumbnailSizes: readonly number[];
  }) => { src: string; srcSet: string; sizes: string } | null;
  processMarkdown: ({ markdown, plugin }: { markdown: string; plugin: Plugin<[], MarkdownNode> }) => Promise<string>;
};

export type FigureProperties = { class?: string; style?: string };

export function ensureImageBlockSeparation(markdown: string): string {
  // Matches markdown images that occupy a single line on their own (with optional spaces/tabs)
  // E.g., `![alt](url)` or standard markdown links
  return markdown.replace(/(?:^|\n)([ \t]*!\[[^\]]*\]\([^)]+\)[ \t]*)(?=\n|$)/g, '\n\n$1\n\n');
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function serializeFigureProperties(properties: FigureProperties): string {
  const attributes = Object.entries(properties)
    .filter((entry): entry is [keyof FigureProperties, string] => typeof entry[1] === "string" && entry[1].length > 0)
    .map(([key, value]) => `${key}="${escapeHtmlAttribute(value)}"`);

  return attributes.length > 0 ? ` ${attributes.join(" ")}` : "";
}

export function wrapTablesInFigures(
  htmlContent: string,
  getFigureProperties?: () => FigureProperties,
): string {
  const wrappedTables = htmlContent.replace(/<table(?:\s[^>]*)?>[\s\S]*?<\/table>/g, (tableHtml, offset, fullHtml) => {
    const precedingHtml = fullHtml.slice(0, offset);
    const lastFigureOpenIndex = precedingHtml.search(/<figure\b[^>]*>\s*$/i);
    const lastFigureCloseIndex = precedingHtml.lastIndexOf("</figure>");
    if (lastFigureOpenIndex > lastFigureCloseIndex) {
      return tableHtml;
    }

    const properties = getFigureProperties ? getFigureProperties() : {};
    const attributes = serializeFigureProperties(properties);
    return `<figure${attributes}>\n${tableHtml}\n</figure>`;
  });

  return wrappedTables.replace(
    /(<figure(?:\s[^>]*)?>\s*<table(?:\s[^>]*)?>[\s\S]*?<\/table>\s*)<\/figure>\s*<p><em>([\s\S]*?)<\/em><\/p>/g,
    (_match: string, figureWithTable: string, captionHtml: string) => {
      return `${figureWithTable}<figcaption>${captionHtml}</figcaption>\n</figure>`;
    }
  );
}

export function createMarkdownRenderer(deps: MarkdownRendererDeps) {
  function applyResponsiveImages({
    tree,
    thumbnailSizes,
    getFigureProperties,
  }: {
    tree: MarkdownNode;
    thumbnailSizes: readonly number[];
    getFigureProperties?: (largestWidth: number) => FigureProperties;
  }) {
    const normalizedSizes = normalizeThumbnailSizes(thumbnailSizes);
    const largestWidth = normalizedSizes[normalizedSizes.length - 1] || 768;
    const figureProps = getFigureProperties
      ? getFigureProperties(largestWidth)
      : { class: "image-figure" };

    function visit(node: MarkdownNode) {
      if (node.children) {
        for (let i = 0; i < node.children.length; i++) {
          const child = node.children[i];
          const nonWhitespaceChildren = child.children?.filter(
            c => !(c.type === "text" && c.value?.trim() === "")
          ) || [];

          if (child.type === "paragraph" && nonWhitespaceChildren.length === 1 && nonWhitespaceChildren[0].type === "image") {
            const imgNode = nonWhitespaceChildren[0];
            const imgUrl = imgNode.url || "";
            const attributes = deps.getResponsiveImageAttributes({ src: imgUrl, thumbnailSizes });
            const srcVal = attributes ? attributes.src : encodeURI(imgUrl);
            const altText = imgNode.alt || '';

            const imgProperties: Record<string, string> = {
              src: srcVal,
              style: "max-width: 100%;",
            };
            if (altText) {
              imgProperties.alt = altText;
            }
            if (attributes) {
              imgProperties.srcset = attributes.srcSet;
              imgProperties.sizes = `(max-width: ${largestWidth}px) 100vw, ${largestWidth}px`;
            }
            imgProperties.loading = "lazy";
            imgProperties.decoding = "async";

            const hChildren: MarkdownNode[] = [
              {
                type: "element",
                tagName: "img",
                properties: imgProperties,
                children: [],
              }
            ];

            let hasCustomCaption = false;
            let customCaptionNode: MarkdownNode | null = null;
            if (i + 1 < node.children.length) {
              const nextSibling = node.children[i + 1];
              const siblingChildren = nextSibling.children || [];
              if (nextSibling.type === "paragraph" && siblingChildren.length === 1 && siblingChildren[0].type === "emphasis") {
                hasCustomCaption = true;
                customCaptionNode = siblingChildren[0];
              }
            }

            if (hasCustomCaption && customCaptionNode) {
              function mapMdastToHast(n: MarkdownNode): MarkdownNode {
                if (n.type === 'text') {
                  return { type: 'text', value: n.value };
                }
                if (n.type === 'link') {
                  return {
                    type: 'element',
                    tagName: 'a',
                    properties: { href: n.url || "" },
                    children: (n.children || []).map(mapMdastToHast),
                  };
                }
                if (n.type === 'strong') {
                  return {
                    type: 'element',
                    tagName: 'strong',
                    children: (n.children || []).map(mapMdastToHast),
                  };
                }
                if (n.type === 'emphasis') {
                  return {
                    type: 'element',
                    tagName: 'em',
                    children: (n.children || []).map(mapMdastToHast),
                  };
                }
                return {
                  type: 'element',
                  tagName: 'span',
                  children: (n.children || []).map(mapMdastToHast),
                };
              }

              hChildren.push({
                type: "element",
                tagName: "figcaption",
                properties: {},
                children: (customCaptionNode.children || []).map(mapMdastToHast),
              });

              // Remove the consumed caption sibling
              node.children.splice(i + 1, 1);
            } else if (altText) {
              hChildren.push({
                type: "element",
                tagName: "figcaption",
                properties: {},
                children: [
                  {
                    type: "text",
                    value: altText,
                  }
                ],
              });
            }

            child.type = "image-figure";
            child.data = {
              ...child.data,
              hName: "figure",
              hProperties: {
                ...figureProps,
              },
              hChildren,
            };
            delete child.children;
          } else {
            visit(child);
          }
        }
      }

      if (node.type === "image" && node.url) {
        const attributes = deps.getResponsiveImageAttributes({ src: node.url, thumbnailSizes });
        if (attributes) {
          node.data = {
            ...node.data,
            hProperties: {
              ...node.data?.hProperties,
              src: attributes.src,
              srcset: attributes.srcSet,
              sizes: attributes.sizes,
              style: "max-width: 100%;",
              loading: "lazy",
              decoding: "async",
            },
          };
        }
      }
    }

    visit(tree);
  }

  function responsiveImagePlugin({
    thumbnailSizes,
    getFigureProperties,
  }: {
    thumbnailSizes: readonly number[];
    getFigureProperties?: (largestWidth: number) => FigureProperties;
  }): Plugin<[], MarkdownNode> {
    return function transformResponsiveImages() {
      return function transformer(tree: MarkdownNode) {
        applyResponsiveImages({ tree, thumbnailSizes, getFigureProperties });
      };
    };
  }

  return {
    applyResponsiveImages,
    responsiveImagePlugin,
    renderMarkdownContent({
      markdown,
      thumbnailSizes,
      assetFiles,
      publicFiles,
      getFigureProperties,
      getTableFigureProperties,
      noteReferences,
    }: {
      markdown: string;
      thumbnailSizes: readonly number[];
      assetFiles?: readonly string[];
      publicFiles?: readonly string[];
      getFigureProperties?: (largestWidth: number) => FigureProperties;
      getTableFigureProperties?: () => FigureProperties;
      noteReferences?: readonly NoteReference[];
    }): Promise<string> {
      const availableFiles = assetFiles || publicFiles;
      let preprocessed = preprocessWikilinks(markdown, availableFiles || [], noteReferences);
      preprocessed = availableFiles ? resolveMarkdownImagePaths({ markdown: preprocessed, availableFiles }) : preprocessed;
      preprocessed = ensureImageBlockSeparation(preprocessed);
      return deps.processMarkdown({
        markdown: preprocessed,
        plugin: responsiveImagePlugin({ thumbnailSizes, getFigureProperties }),
      }).then((htmlContent) => wrapTablesInFigures(htmlContent, getTableFigureProperties));
    },
  };
}

export function preprocessWikilinks(
  markdown: string,
  availableFiles: readonly string[],
  noteReferences: readonly NoteReference[] = []
): string {
  let preprocessed = markdown;
  for (let pass = 0; pass < 10; pass += 1) {
    const next = preprocessWikilinksOnce(preprocessed, availableFiles, noteReferences);
    if (next === preprocessed) {
      return next;
    }
    preprocessed = next;
  }
  return preprocessed;
}

function preprocessWikilinksOnce(
  markdown: string,
  availableFiles: readonly string[],
  noteReferences: readonly NoteReference[]
): string {
  const noteResolver = createNoteReferenceResolver({ notes: noteReferences });
  const embedRegex = /!\[\[([^\]]+)\]\]/g;
  const linkRegex = /(^|[^!])\[\[([^\]]+)\]\]/g;

  const withEmbeds = markdown.replace(embedRegex, (match, content) => {
    const { target } = parseWikilinkContent({ content });
    const normalizedFilename = target.toLowerCase();
    const resolvedPath = availableFiles.find((file) => {
      const base = file.split('/').pop()?.toLowerCase();
      return base === normalizedFilename;
    });

    if (resolvedPath) {
      const alt = getImageAltFromWikilinkContent({ content });
      return `![${alt}](</${resolvedPath}>)`;
    }

    const noteReference = noteResolver.resolve({ target });
    if (noteReference?.content) {
      return `\n\n${noteReference.content.trim()}\n\n`;
    }

    return match;
  });

  return withEmbeds.replace(linkRegex, (match, prefix, content) => {
    const { target, label } = parseWikilinkContent({ content });
    const noteReference = noteResolver.resolve({ target });
    if (!noteReference || noteReference.linkable === false) {
      return match;
    }

    return `${prefix}[${label || noteReference.title}](${noteReference.href})`;
  });
}

function getImageAltFromWikilinkContent({ content }: { content: string }): string {
  const parts = content.split("|").slice(1);
  let alt = "";
  for (const part of parts) {
    const trimmed = part.trim();
    if (!/^\d+$/.test(trimmed)) {
      alt = trimmed;
    }
  }
  return alt;
}

const defaultMarkdownRenderer = createMarkdownRenderer({
  getResponsiveImageAttributes,
  processMarkdown: async ({ markdown, plugin }) => {
    const processedContent = await remark().use(gfm).use(plugin).use(html, { sanitize: false }).process(markdown);
    return processedContent.toString();
  },
});

export const responsiveImagePlugin = defaultMarkdownRenderer.responsiveImagePlugin;
export const applyResponsiveImages = defaultMarkdownRenderer.applyResponsiveImages;
export const renderMarkdownContent = defaultMarkdownRenderer.renderMarkdownContent;
