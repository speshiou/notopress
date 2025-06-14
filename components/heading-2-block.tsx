import React from "react";
import { RichText } from "./rich-text";
import { Heading2BlockObjectResponse } from "@notionhq/client/build/src/api-endpoints";

export function Heading2Block({
  block,
}: {
  block: Heading2BlockObjectResponse;
}) {
  if (!block || !block.heading_2) return <h2 />;
  const { rich_text } = block.heading_2;
  if (!rich_text || rich_text.length === 0) return <h2 />;
  return (
    <h2 className="text-3xl font-semibold mb-3">
      <RichText richTextArray={rich_text} />
    </h2>
  );
}
