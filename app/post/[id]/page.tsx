import { notFound } from "next/navigation";
import { fetchPageBlocks, fetchPageMetadata } from "../../../lib/notion";
import { isFullBlock } from "@notionhq/client";
import ParagraphBlock from "../../../components/ParagraphBlock";
import ImageBlock from "../../../components/ImageBlock";

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
  if (!blocks || blocks.length === 0) {
    notFound();
  }
  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block) => {
        if (!isFullBlock(block)) {
          return null;
        }
        switch (block.type) {
          case "paragraph":
            return <ParagraphBlock key={block.id} block={block} />;
          case "image":
            return <ImageBlock key={block.id} block={block} />;
          // Add more cases for other block types as needed
          default:
            return null; // Handle unsupported block types
        }
      })}
    </div>
  );
}
