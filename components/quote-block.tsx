import React from "react";
import { renderRichText } from "../lib/render-rich-text";
import { QuoteBlockObjectResponse } from "@notionhq/client/build/src/api-endpoints";

function QuoteBlock({ block }: { block: QuoteBlockObjectResponse }) {
  if (!block || !block.quote) {
    return (
      <blockquote className="border-l-4 border-base-300 pl-4 italic my-4 bg-base-200 rounded"></blockquote>
    );
  }

  const { rich_text } = block.quote;

  return (
    <blockquote className="border-l-4 border-base-300 pl-4 italic my-4 bg-base-200 rounded py-2 px-3">
      {renderRichText(rich_text)}
    </blockquote>
  );
}

export default QuoteBlock;
