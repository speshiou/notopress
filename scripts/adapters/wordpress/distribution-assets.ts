import { parse } from '@wordpress/block-serialization-default-parser';
import { collectHtmlAssetUrls } from '../../../src/lib/html-assets';
import { ParsedWordPressBlockSchema } from './raw-blocks';

/** Gutenberg attributes can reference assets without producing saved HTML elements. */
export function collectWordPressAssetUrls({ html, parseBlocks = parse }: {
  html: string;
  parseBlocks?: (content: string) => unknown;
}): readonly string[] {
  const urls = new Set(collectHtmlAssetUrls({ html }));
  function visit(value: unknown): void {
    if (typeof value === 'string') urls.add(value);
    else if (Array.isArray(value)) for (const item of value) visit(item);
    else if (value !== null && typeof value === 'object') for (const item of Object.values(value)) visit(item);
  }
  function visitBlocks(blocks: ReturnType<typeof ParsedWordPressBlockSchema.parse>[]) {
    for (const block of blocks) {
      visit(block.attrs);
      visitBlocks(block.innerBlocks);
    }
  }
  visitBlocks(ParsedWordPressBlockSchema.array().parse(parseBlocks(html)));
  return [...urls].sort();
}
