import { ImageBlockObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import React from "react";

export default function ImageBlock({
  block,
}: {
  block: ImageBlockObjectResponse;
}) {
  const url =
    block.image.type === "external"
      ? block.image.external.url
      : block.image.file.url;
  const caption =
    block.image.caption?.map((c: any) => c.plain_text).join("") || "";
  return (
    <figure>
      <img src={url} alt={caption} className="max-w-full" />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}
