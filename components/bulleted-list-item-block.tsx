import React from "react";
import { RichText } from "./rich-text";
import { BulletedListItemBlockObjectResponse } from "@notionhq/client/build/src/api-endpoints";

function BulletedListItemBlock({
  block,
}: {
  block: BulletedListItemBlockObjectResponse;
}) {
  if (!block || !block.bulleted_list_item) {
    return <li className="list-disc ml-6"></li>;
  }

  const { rich_text } = block.bulleted_list_item;

  return (
    <li className="list-disc ml-6 py-1">
      <RichText richTextArray={rich_text} />
    </li>
  );
}

export default BulletedListItemBlock;
