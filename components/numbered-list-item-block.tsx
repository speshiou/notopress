import React from "react";
import { renderRichText } from "../lib/render-rich-text"; // Adjusted path
import { NumberedListItemBlockObjectResponse } from "@notionhq/client/build/src/api-endpoints";

function NumberedListItemBlock({
  block,
}: {
  block: NumberedListItemBlockObjectResponse;
}) {
  if (!block || !block.numbered_list_item) {
    return <li></li>; // Render an empty li if block content is missing
  }

  const { rich_text } = block.numbered_list_item;

  // TODO: Handle children for nested lists if necessary
  return <li>{renderRichText(rich_text)}</li>;
}

export default NumberedListItemBlock;
