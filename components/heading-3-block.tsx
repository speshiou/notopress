import React from "react";
import { RichText } from "./rich-text";
import { Heading3BlockObjectResponse } from "@notionhq/client/build/src/api-endpoints";

export function Heading3Block({
  block,
}: {
  block: Heading3BlockObjectResponse;
}) {
  if (!block || !block.heading_3) return <h3 />;
  const { rich_text } = block.heading_3;
  if (!rich_text || rich_text.length === 0) return <h3 />;
  return (
    <h3 className="text-2xl font-medium mb-2">
      <RichText richTextArray={rich_text} />
    </h3>
  );
}
