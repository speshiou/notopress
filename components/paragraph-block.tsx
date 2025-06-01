import { ParagraphBlockObjectResponse } from "@notionhq/client";
import React from "react";
import { RichText } from "./rich-text"; // Adjusted path

export default function ParagraphBlock({
  block,
}: {
  block: ParagraphBlockObjectResponse;
}) {
  // The rich_text from ParagraphBlockObjectResponse should be compatible with
  // RichTextItemResponse[] expected by renderRichText.
  return (
    <p className="text-lg">
      <RichText richTextArray={block.paragraph.rich_text} />
    </p>
  );
}
