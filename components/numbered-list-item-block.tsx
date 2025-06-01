import React from "react";
import { renderRichText } from "../lib/render-rich-text"; // Adjusted path
import { NumberedListItemBlockObjectResponse } from "@notionhq/client/build/src/api-endpoints";

function NumberedListItemBlock({
  block,
}: {
  block: NumberedListItemBlockObjectResponse;
}) {
  if (!block || !block.numbered_list_item) {
    return <li className="list-decimal ml-6"></li>;
  }

  const { rich_text } = block.numbered_list_item;

  return (
    <li className="list-decimal ml-6 py-1">{renderRichText(rich_text)}</li>
  );
}

export default NumberedListItemBlock;
