import React from "react"; // useEffect and useState are removed
import {
  BlockObjectResponse,
  isFullBlock,
  PartialBlockObjectResponse,
} from "@notionhq/client";
import ParagraphBlock from "@/components/paragraph-block";
import ImageBlock from "@/components/image-block"; // Component for rendering image blocks
import { Heading1Block } from "@/components/heading-1-block";
import { Heading2Block } from "@/components/heading-2-block";
import { Heading3Block } from "@/components/heading-3-block"; // Component for rendering heading blocks
import BulletedListItemBlock from "@/components/bulleted-list-item-block"; // Component for rendering bulleted list items
import NumberedListItemBlock from "@/components/numbered-list-item-block"; // Component for rendering numbered list items
import QuoteBlock from "@/components/quote-block"; // Component for rendering quote blocks
import CodeBlock from "@/components/code-block"; // Component for rendering code blocks
import { fetchPageBlocks } from "@/lib/notion";

// Re-using the Block type from Notion SDK is preferable, but for now, this defines the minimum needed.
// The actual blocks from fetchPageBlocks should conform to Notion's BlockObjectResponse.
// https://developers.notion.com/reference/block
// It's good practice to use the actual BlockObjectResponse type from @notionhq/client if possible,
// or define a more specific type if the generic `any` is too broad.
type Block = {
  id: string;
  type: string;
  [key: string]: any; // Allow other properties
};

type NotionPageProps = {
  pageId: string;
};

// Convert to an async Server Component
const NotionPage = async ({ pageId }: NotionPageProps) => {
  let blocks: (PartialBlockObjectResponse | BlockObjectResponse)[] = [];
  let error: string | null = null;

  try {
    blocks = await fetchPageBlocks({ pageId });
  } catch (err) {
    console.error(`Failed to fetch page content for pageId ${pageId}:`, err);
    error = "Failed to fetch page content.";
    // Optionally, re-throw or handle specific error types for `notFound()` or other responses
  }

  // Loading state is implicitly handled by Suspense if this component is wrapped
  // For direct rendering, the page will wait until data is fetched or an error occurs.

  if (error) {
    return <div>Error: {error}</div>;
  }

  return (
    <div>
      {(() => {
        const elements: React.ReactNode[] = [];
        let i = 0;
        while (i < blocks.length) {
          const block = blocks[i];
          if (!isFullBlock(block)) {
            // Log or handle partial blocks as needed. For now, skipping them.
            console.warn(
              `Encountered a partial block (ID: ${block.id}). Skipping rendering.`
            );
            i++;
            continue;
          }

          // Group consecutive bulleted_list_item
          if (block.type === "bulleted_list_item") {
            const listItems = [];
            let j = i;
            while (j < blocks.length) {
              const listBlock = blocks[j];
              if (
                !isFullBlock(listBlock) ||
                listBlock.type !== "bulleted_list_item"
              ) {
                break; // Ensure we only process full blocks of the correct type
              }
              listItems.push(
                <BulletedListItemBlock key={listBlock.id} block={listBlock} />
              );
              j++;
            }
            elements.push(
              <ul key={`bulleted-list-${block.id}`}>{listItems}</ul>
            );
            i = j;
            continue;
          }

          // Group consecutive numbered_list_item
          if (block.type === "numbered_list_item") {
            const listItems = [];
            let j = i;
            while (j < blocks.length) {
              const listBlock = blocks[j];
              if (
                !isFullBlock(listBlock) ||
                listBlock.type !== "numbered_list_item"
              ) {
                break; // Ensure we only process full blocks of the correct type
              }
              listItems.push(
                <NumberedListItemBlock key={listBlock.id} block={listBlock} />
              );
              j++;
            }
            elements.push(
              <ol key={`numbered-list-${block.id}`}>{listItems}</ol>
            );
            i = j;
            continue;
          }

          switch (block.type) {
            case "heading_1":
              elements.push(<Heading1Block key={block.id} block={block} />);
              break;
            case "heading_2":
              elements.push(<Heading2Block key={block.id} block={block} />);
              break;
            case "heading_3":
              elements.push(<Heading3Block key={block.id} block={block} />);
              break;
            case "paragraph":
              elements.push(<ParagraphBlock key={block.id} block={block} />);
              break;
            case "image":
              elements.push(<ImageBlock key={block.id} block={block} />);
              break;
            case "quote":
              elements.push(<QuoteBlock key={block.id} block={block} />);
              break;
            case "code":
              elements.push(<CodeBlock key={block.id} block={block} />);
              break;
            default:
              elements.push(
                <div
                  key={block.id}
                  style={{
                    marginBottom: "10px",
                    padding: "10px",
                    border: "1px solid #ccc",
                  }}
                >
                  <p>Unsupported block type: {block.type}</p>
                  <p>Block ID: {block.id}</p>
                </div>
              );
          }
          i++;
        }
        return elements;
      })()}
    </div>
  );
};

export default NotionPage;
