import { ImageBlockObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import React from "react";
import Image from "next/image";

export default function ImageBlock({
  block,
}: {
  block: ImageBlockObjectResponse;
}) {
  const url =
    block.image.type === "external"
      ? block.image.external.url
      : block.image.file.url;
  const caption = block.image.caption?.map((c) => c.plain_text).join("") || "";
  return (
    <figure>
      <Image
        src={url}
        alt={caption}
        width={800}
        height={600}
        className="max-w-full"
        style={{ height: "auto" }}
      />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}
