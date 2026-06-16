import { remark } from "remark";
import html from "remark-html";
import type { Plugin } from "unified";
import { getResponsiveImageAttributes } from "./responsive-images";

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

export function createMarkdownRenderer(deps: MarkdownRendererDeps) {
  function applyResponsiveImages({ tree, thumbnailSizes }: { tree: MarkdownNode; thumbnailSizes: readonly number[] }) {
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
          imgProperties.sizes = attributes.sizes;
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
            class: "wp-block-image",
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

  function responsiveImagePlugin({ thumbnailSizes }: { thumbnailSizes: readonly number[] }): Plugin<[], MarkdownNode> {
    return function transformResponsiveImages() {
      return function transformer(tree: MarkdownNode) {
        applyResponsiveImages({ tree, thumbnailSizes });
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
    }: {
      markdown: string;
      thumbnailSizes: readonly number[];
      publicFiles?: readonly string[];
    }): Promise<string> {
      const preprocessed = publicFiles ? preprocessWikilinks(markdown, publicFiles) : markdown;
      return deps.processMarkdown({
        markdown: preprocessed,
        plugin: responsiveImagePlugin({ thumbnailSizes }),
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

