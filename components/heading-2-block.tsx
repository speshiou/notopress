import React from "react";
import { renderRichText } from "../lib/render-rich-text";
import { Heading2BlockObjectResponse } from "@notionhq/client/build/src/api-endpoints";

export function Heading2Block({
  block,
}: {
  block: Heading2BlockObjectResponse;
}) {
  if (!block || !block.heading_2) return <h2 />;
  const { rich_text } = block.heading_2;
  if (!rich_text || rich_text.length === 0) return <h2 />;
  return <h2>{renderRichText(rich_text)}</h2>;
}
