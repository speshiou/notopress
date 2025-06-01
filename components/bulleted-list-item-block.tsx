import React from 'react';
import { renderRichText, RichTextItemResponse } from '../lib/render-rich-text'; // Adjusted path

interface BulletedListItemBlockSpecifics {
  rich_text: RichTextItemResponse[];
  color: string;
  children?: any[]; // For nested lists, actual type would be Block[] or similar
}

interface BulletedListItemProps {
  block: {
    id: string;
    type: 'bulleted_list_item';
    bulleted_list_item?: BulletedListItemBlockSpecifics;
  };
}

const BulletedListItemBlock: React.FC<BulletedListItemProps> = ({ block }) => {
  if (!block || !block.bulleted_list_item) {
    return <li></li>; // Render an empty li if block content is missing
  }

  const { rich_text } = block.bulleted_list_item;

  // TODO: Handle children for nested lists if necessary
  return <li>{renderRichText(rich_text)}</li>;
};

export default BulletedListItemBlock;
