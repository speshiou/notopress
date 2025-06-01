import React from 'react';
import { renderRichText, RichTextItemResponse } from '../lib/render-rich-text'; // Adjusted path

interface NumberedListItemBlockSpecifics {
  rich_text: RichTextItemResponse[];
  color: string;
  children?: any[]; // For nested lists, actual type would be Block[] or similar
}

interface NumberedListItemProps {
  block: {
    id: string;
    type: 'numbered_list_item';
    numbered_list_item?: NumberedListItemBlockSpecifics;
  };
}

const NumberedListItemBlock: React.FC<NumberedListItemProps> = ({ block }) => {
  if (!block || !block.numbered_list_item) {
    return <li></li>; // Render an empty li if block content is missing
  }

  const { rich_text } = block.numbered_list_item;

  // TODO: Handle children for nested lists if necessary
  return <li>{renderRichText(rich_text)}</li>;
};

export default NumberedListItemBlock;
