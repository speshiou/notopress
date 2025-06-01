import React from 'react';
import { renderRichText, RichTextItemResponse } from '../lib/render-rich-text';

// Assuming BlockObjectResponse or a similar encompassing type would be used in a real scenario.
// For now, this local interface defines what QuoteBlock expects.
// Based on Notion's API: block.quote.rich_text
interface QuoteBlockSpecifics {
  rich_text: RichTextItemResponse[];
  color: string;
  // children?: BlockObjectResponse[]; // Quotes can have children blocks
}

interface QuoteBlockProps {
  block: {
    id: string;
    type: 'quote'; // This should match the type from Notion API
    quote?: QuoteBlockSpecifics;
    // We might need to pass down the full block if children rendering is supported here
  };
}

const QuoteBlock: React.FC<QuoteBlockProps> = ({ block }) => {
  if (!block || !block.quote) {
    // Or handle error appropriately
    return <blockquote className="border-l-4 border-gray-300 pl-4 italic my-4"></blockquote>;
  }

  const { rich_text } = block.quote;

  // TODO: Handle children blocks if the quote block has them.
  // This might involve recursively calling a block renderer for `block.quote.children`.
  return (
    <blockquote className="border-l-4 border-gray-300 pl-4 italic my-4">
      {renderRichText(rich_text)}
    </blockquote>
  );
};

export default QuoteBlock;
