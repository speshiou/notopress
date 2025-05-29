import { notFound } from "next/navigation";
import { fetchPageBlocks, fetchPageMetadata } from "../../../lib/notion";
import { isFullBlock } from "@notionhq/client";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  try {
    const data = await fetchPageMetadata({ pageId: id });
    const { Name } = data.properties;

    return {
      title: Name.type === "title" ? Name.title[0]?.plain_text : "Untitled",
      // description: content,
    };
  } catch (error) {
    console.error("Error generating metadata:", error);
    return {
      title: "Error",
      description: "Could not fetch the page content.",
    };
  }
}

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const blocks = await fetchPageBlocks({ pageId: id });
  // render the blocks
  if (!blocks || blocks.length === 0) {
    notFound();
  }
  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block) => {
        if (!isFullBlock(block)) {
          return null; // Skip if the block is not a full block
        }
        if (block.type === "paragraph") {
          return (
            <p key={block.id} className="text-lg">
              {block.paragraph.rich_text
                .map((text) => text.plain_text)
                .join("")}
            </p>
          );
        }
        // Add more block types as needed
        return null;
      })}
    </div>
  );
}
