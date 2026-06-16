import { remark } from "remark";
import html from "remark-html";
import type { Plugin } from "unified";
import { getResponsiveImageAttributes, normalizeThumbnailSizes } from "./responsive-images";

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
      if (node.type === "paragraph" && node.children && node.children.length === 1 && node.children[0].type === "image") {
        const imgNode = node.children[0];
        const imgUrl = imgNode.url || "";
        const attributes = deps.getResponsiveImageAttributes({ src: imgUrl, thumbnailSizes });
        const srcVal = attributes ? attributes.src : encodeURI(imgUrl);
        const altText = imgNode.alt || '';

        const imgProperties: Record<string, string> = {
          src: srcVal,
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

        const children: MarkdownNode[] = [
          {
            type: "element",
            tagName: "img",
            properties: imgProperties,
            children: [],
          }
        ];

        if (altText) {
          children.push({
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

        node.type = "image-figure";
        node.data = {
          ...node.data,
          hName: "figure",
          hProperties: {
            ...figureProps,
          },
          hChildren: children,
        };
        delete node.children;
        return;
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
              loading: "lazy",
              decoding: "async",
            },
          };
        }
      }

      for (const child of node.children || []) {
        visit(child);
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
      publicFiles,
      getFigureProperties,
    }: {
      markdown: string;
      thumbnailSizes: readonly number[];
      publicFiles?: readonly string[];
      getFigureProperties?: (largestWidth: number) => { class?: string; style?: string };
    }): Promise<string> {
      let preprocessed = publicFiles ? preprocessWikilinks(markdown, publicFiles) : markdown;
      preprocessed = ensureImageBlockSeparation(preprocessed);
      return deps.processMarkdown({
        markdown: preprocessed,
        plugin: responsiveImagePlugin({ thumbnailSizes, getFigureProperties }),
      });
    },
  };
}

export function preprocessWikilinks(markdown: string, publicFiles: readonly string[]): string {
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
    const resolvedPath = publicFiles.find((file) => {
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
    const processedContent = await remark().use(plugin).use(html, { sanitize: false }).process(markdown);
    return processedContent.toString();
  },
});

export const responsiveImagePlugin = defaultMarkdownRenderer.responsiveImagePlugin;
export const applyResponsiveImages = defaultMarkdownRenderer.applyResponsiveImages;
export const renderMarkdownContent = defaultMarkdownRenderer.renderMarkdownContent;

