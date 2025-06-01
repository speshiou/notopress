import React from 'react'; // useEffect and useState are removed
import { fetchPageBlocks } from '../lib/notion';
import { isFullBlock } from "@notionhq/client";
import ParagraphBlock from "@/components/paragraph-block";
import ImageBlock from "@/components/image-block"; // Component for rendering image blocks
import HeadingBlock from "@/components/heading-block"; // Component for rendering heading blocks
import BulletedListItemBlock from "@/components/bulleted-list-item-block"; // Component for rendering bulleted list items
import NumberedListItemBlock from "@/components/numbered-list-item-block"; // Component for rendering numbered list items
import QuoteBlock from "@/components/quote-block"; // Component for rendering quote blocks
import CodeBlock from "@/components/code-block"; // Component for rendering code blocks

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
  let blocks: Block[] | null = null;
  let error: string | null = null;

  try {
    const fetchedBlocks = await fetchPageBlocks({ pageId });
    if (fetchedBlocks && fetchedBlocks.length > 0) {
      blocks = fetchedBlocks as Block[]; // Assuming fetchPageBlocks returns compatible objects
    } else {
      blocks = []; // No blocks found
    }
  } catch (err) {
    console.error(`Failed to fetch page content for pageId ${pageId}:`, err);
    error = 'Failed to fetch page content.';
    // Optionally, re-throw or handle specific error types for `notFound()` or other responses
  }

  // Loading state is implicitly handled by Suspense if this component is wrapped
  // For direct rendering, the page will wait until data is fetched or an error occurs.

  if (error) {
    return <div>Error: {error}</div>;
  }

  if (!blocks || blocks.length === 0) {
    return <div>No blocks found for this page.</div>;
  }

  return (
    <div>
      <h1>Page Content</h1>
      {blocks.map((block) => {
        if (!isFullBlock(block)) {
          // Log or handle partial blocks as needed. For now, skipping them.
          console.warn(`Encountered a partial block (ID: ${block.id}). Skipping rendering.`);
          return (
            <div key={block.id} style={{ display: 'none' }}>
              Partial block (ID: {block.id}) not rendered.
            </div>
          );
        }

        switch (block.type) {
          case 'paragraph':
            return <ParagraphBlock key={block.id} block={block} />;
          case 'image':
            return <ImageBlock key={block.id} block={block} />;
          case 'heading_1':
          case 'heading_2':
          case 'heading_3':
            return <HeadingBlock key={block.id} block={block} />;
          case 'bulleted_list_item':
            // For list items, Notion expects them to be wrapped in <ul> or <ol>.
            // This basic renderer handles them individually. A more complex renderer
            // might group consecutive list items.
            return <BulletedListItemBlock key={block.id} block={block} />;
          case 'numbered_list_item':
            return <NumberedListItemBlock key={block.id} block={block} />;
          case 'quote':
            return <QuoteBlock key={block.id} block={block} />;
          case 'code':
            return <CodeBlock key={block.id} block={block} />;
          default:
            return (
              <div key={block.id} style={{ marginBottom: '10px', padding: '10px', border: '1px solid #ccc' }}>
                <p>Unsupported block type: {block.type}</p>
                <p>Block ID: {block.id}</p>
              </div>
            );
        }
      })}
    </div>
  );
};

export default NotionPage;
