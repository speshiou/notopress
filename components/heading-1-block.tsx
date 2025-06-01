import React from "react";
import { renderRichText } from "../lib/render-rich-text";
import { Heading1BlockObjectResponse } from "@notionhq/client/build/src/api-endpoints";

export function Heading1Block({
  block,
}: {
  block: Heading1BlockObjectResponse;
}) {
  if (!block || !block.heading_1) return <h1 />;
  const { rich_text } = block.heading_1;
  if (!rich_text || rich_text.length === 0) return <h1 />;
  return <h1>{renderRichText(rich_text)}</h1>;
}
