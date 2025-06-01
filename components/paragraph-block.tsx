import { ParagraphBlockObjectResponse } from "@notionhq/client";
import React from "react";

export default function ParagraphBlock({
  block,
}: {
  block: ParagraphBlockObjectResponse;
}) {
  return (
    <p className="text-lg">
      {block.paragraph.rich_text.map((text) => text.plain_text).join("")}
    </p>
  );
}
