import React from "react";
import { renderRichText } from "../lib/render-rich-text"; // Adjusted path
import { BulletedListItemBlockObjectResponse } from "@notionhq/client/build/src/api-endpoints";

function BulletedListItemBlock({
  block,
}: {
  block: BulletedListItemBlockObjectResponse;
}) {
  if (!block || !block.bulleted_list_item) {
    return <li></li>; // Render an empty li if block content is missing
  }

  const { rich_text } = block.bulleted_list_item;

  // TODO: Handle children for nested lists if necessary
  return <li>{renderRichText(rich_text)}</li>;
}

export default BulletedListItemBlock;
