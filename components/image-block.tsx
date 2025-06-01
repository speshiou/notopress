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
    <figure className="my-6">
      <Image
        src={url}
        alt={caption}
        width={800}
        height={600}
        className="max-w-full rounded-lg shadow-lg"
        style={{ height: "auto" }}
      />
      {caption && (
        <figcaption className="text-center text-sm text-base-content/60 mt-2">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
