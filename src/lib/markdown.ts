import { remark } from "remark";
import html from "remark-html";
import gfm from "remark-gfm";
import type { Plugin } from "unified";
import { getResponsiveImageAttributes, normalizeThumbnailSizes } from "./responsive-images";
import { resolveMarkdownImagePaths } from "./local-images";

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

export function ensureImageBlockSeparation(markdown: string): string {
  // Matches markdown images that occupy a single line on their own (with optional spaces/tabs)
  // E.g., `![alt](url)` or standard markdown links
  return markdown.replace(/(?:^|\n)([ \t]*!\[[^\]]*\]\([^)]+\)[ \t]*)(?=\n|$)/g, '\n\n$1\n\n');
}

export function createMarkdownRenderer(deps: MarkdownRendererDeps) {
  function applyResponsiveImages({
    tree,
    thumbnailSizes,
    getFigureProperties,
  }: {
    tree: MarkdownNode;
    thumbnailSizes: readonly number[];
    getFigureProperties?: (largestWidth: number) => { class?: string; style?: string };
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
    getFigureProperties?: (largestWidth: number) => { class?: string; style?: string };
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
    }: {
      markdown: string;
      thumbnailSizes: readonly number[];
      assetFiles?: readonly string[];
      publicFiles?: readonly string[];
      getFigureProperties?: (largestWidth: number) => { class?: string; style?: string };
    }): Promise<string> {
      const availableFiles = assetFiles || publicFiles;
      let preprocessed = availableFiles ? preprocessWikilinks(markdown, availableFiles) : markdown;
      preprocessed = availableFiles ? resolveMarkdownImagePaths({ markdown: preprocessed, availableFiles }) : preprocessed;
      preprocessed = ensureImageBlockSeparation(preprocessed);
      return deps.processMarkdown({
        markdown: preprocessed,
        plugin: responsiveImagePlugin({ thumbnailSizes, getFigureProperties }),
      });
    },
  };
}

export function preprocessWikilinks(markdown: string, availableFiles: readonly string[]): string {
  const wikilinkRegex = /!\[\[([^\]]+)\]\]/g;
  return markdown.replace(wikilinkRegex, (match, content) => {
    const parts = content.split('|');
    const filename = parts[0].trim();

    let alt = '';
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i].trim();
      if (!/^\d+$/.test(part)) {
        alt = part;
      }
    }

    const normalizedFilename = filename.toLowerCase();
    const resolvedPath = availableFiles.find((file) => {
      const base = file.split('/').pop()?.toLowerCase();
      return base === normalizedFilename;
    });

    if (resolvedPath) {
      return `![${alt}](</${resolvedPath}>)`;
    }

    return match;
  });
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
