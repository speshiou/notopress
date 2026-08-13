import { z } from 'zod';

export type ParsedWordPressBlock = {
  blockName: string | null;
  attrs: Record<string, unknown> | null;
  innerBlocks: ParsedWordPressBlock[];
  innerHTML: string;
  innerContent: Array<string | null>;
};

type RawBlockConverterDeps = {
  parseBlocks: ({ content }: { content: string }) => unknown;
  convertHtml: ({ html }: { html: string }) => string;
};

export type RawBlockConversion = {
  markdown: string;
  preservedBlockNames: string[];
};

const ParsedWordPressBlockSchema: z.ZodType<ParsedWordPressBlock> = z.lazy(() => z.object({
  blockName: z.string().nullable(),
  attrs: z.record(z.string(), z.unknown()).nullable(),
  innerBlocks: z.array(ParsedWordPressBlockSchema),
  innerHTML: z.string(),
  innerContent: z.array(z.string().nullable()),
}));

function serializeAttributes(attributes: Record<string, unknown> | null): string {
  return attributes && Object.keys(attributes).length > 0 ? ` ${JSON.stringify(attributes)}` : '';
}

function getSerializedName(blockName: string): string {
  return blockName.startsWith('core/') ? blockName.slice('core/'.length) : blockName;
}

function serializeBlock(block: ParsedWordPressBlock): string {
  if (!block.blockName) return block.innerHTML;

  const blockName = getSerializedName(block.blockName);
  const attributes = serializeAttributes(block.attrs);
  if (block.innerHTML.length === 0 && block.innerBlocks.length === 0) {
    return `<!-- wp:${blockName}${attributes} /-->`;
  }

  let innerBlockIndex = 0;
  const innerContent = block.innerContent.map((content) => {
    if (content !== null) return content;
    const innerBlock = block.innerBlocks[innerBlockIndex++];
    return innerBlock ? serializeBlock(innerBlock) : '';
  }).join('');

  return `<!-- wp:${blockName}${attributes} -->${innerContent}<!-- /wp:${blockName} -->`;
}

function containsPreservedDescendant(block: ParsedWordPressBlock): boolean {
  return block.innerBlocks.some((innerBlock) => {
    if (!innerBlock.blockName) return false;
    if (!innerBlock.blockName.startsWith('core/')) return true;
    if (innerBlock.innerHTML.trim().length === 0 && innerBlock.innerBlocks.length === 0) return true;
    return containsPreservedDescendant(innerBlock);
  });
}

function reconstructCoreHtml(block: ParsedWordPressBlock): string {
  let innerBlockIndex = 0;
  return block.innerContent.map((content) => {
    if (content !== null) return content;
    const innerBlock = block.innerBlocks[innerBlockIndex++];
    return innerBlock ? reconstructCoreHtml(innerBlock) : '';
  }).join('');
}

export function createRawBlockConverter(deps: RawBlockConverterDeps) {
  return function convertRawBlocks({ content }: { content: string }): RawBlockConversion {
    const parseResult = ParsedWordPressBlockSchema.array().safeParse(deps.parseBlocks({ content }));
    if (!parseResult.success) {
      throw new Error(`Invalid WordPress block parser output: ${z.prettifyError(parseResult.error)}`);
    }

    const preservedBlockNames = new Set<string>();
    const fragments = parseResult.data.map((block) => {
      if (!block.blockName) return deps.convertHtml({ html: block.innerHTML });

      const isCoreBlock = block.blockName.startsWith('core/');
      const hasConvertibleHtml = block.innerHTML.trim().length > 0;
      if (!isCoreBlock || !hasConvertibleHtml || containsPreservedDescendant(block)) {
        preservedBlockNames.add(block.blockName);
        return serializeBlock(block);
      }

      return deps.convertHtml({ html: reconstructCoreHtml(block) });
    });

    return {
      markdown: fragments.filter((fragment) => fragment.trim().length > 0).join('\n\n').replace(/\n{3,}/g, '\n\n').trim(),
      preservedBlockNames: [...preservedBlockNames].sort(),
    };
  };
}
