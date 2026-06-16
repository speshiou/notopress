import { remark } from "remark";
import html from "remark-html";
import type { Plugin } from "unified";
import { getResponsiveImageAttributes } from "./responsive-images";

export type MarkdownNode = {
  type: string;
  url?: string;
  data?: {
    hProperties?: Record<string, string>;
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
    }: {
      markdown: string;
      thumbnailSizes: readonly number[];
    }): Promise<string> {
      return deps.processMarkdown({
        markdown,
        plugin: responsiveImagePlugin({ thumbnailSizes }),
      });
    },
  };
}

const defaultMarkdownRenderer = createMarkdownRenderer({
  getResponsiveImageAttributes,
  processMarkdown: async ({ markdown, plugin }) => {
    const processedContent = await remark().use(plugin).use(html).process(markdown);
    return processedContent.toString();
  },
});

export const responsiveImagePlugin = defaultMarkdownRenderer.responsiveImagePlugin;
export const applyResponsiveImages = defaultMarkdownRenderer.applyResponsiveImages;
export const renderMarkdownContent = defaultMarkdownRenderer.renderMarkdownContent;
