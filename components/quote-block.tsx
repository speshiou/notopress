import React from "react";
import { renderRichText } from "../lib/render-rich-text";
import { QuoteBlockObjectResponse } from "@notionhq/client/build/src/api-endpoints";

function QuoteBlock({ block }: { block: QuoteBlockObjectResponse }) {
  if (!block || !block.quote) {
    // Or handle error appropriately
    return (
      <blockquote className="border-l-4 border-gray-300 pl-4 italic my-4"></blockquote>
    );
  }

  const { rich_text } = block.quote;

  // TODO: Handle children blocks if the quote block has them.
  // This might involve recursively calling a block renderer for `block.quote.children`.
  return (
    <blockquote className="border-l-4 border-gray-300 pl-4 italic my-4">
      {renderRichText(rich_text)}
    </blockquote>
  );
}

export default QuoteBlock;
