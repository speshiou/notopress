import React from 'react';
import { renderRichText, RichTextItemResponse } from '../lib/render-rich-text'; // Adjusted path

// Assuming BlockObjectResponse or a similar encompassing type would be used in a real scenario.
// For now, this local interface defines what HeadingBlock expects.
interface HeadingBlockSpecifics {
  rich_text: RichTextItemResponse[];
  color: string;
  is_toggleable: boolean;
}

interface HeadingBlockProps {
  block: {
    id: string;
    type: 'heading_1' | 'heading_2' | 'heading_3';
    heading_1?: HeadingBlockSpecifics;
    heading_2?: HeadingBlockSpecifics;
    heading_3?: HeadingBlockSpecifics;
  };
}

const HeadingBlock: React.FC<HeadingBlockProps> = ({ block }) => {
  if (!block) return null;

  const { type } = block;
  let richTextContent: RichTextItemResponse[] | undefined = [];
  let Tag: 'h1' | 'h2' | 'h3' | 'p' = 'p';

  switch (type) {
    case 'heading_1':
      richTextContent = block.heading_1?.rich_text;
      Tag = 'h1';
      break;
    case 'heading_2':
      richTextContent = block.heading_2?.rich_text;
      Tag = 'h2';
      break;
    case 'heading_3':
      richTextContent = block.heading_3?.rich_text;
      Tag = 'h3';
      break;
    default:
      console.warn(`Unsupported heading type: ${type}`);
      return <p>Unsupported heading type</p>;
  }

  if (!richTextContent || richTextContent.length === 0) {
    return <Tag />; // Render empty heading tag
  }

  return <Tag>{renderRichText(richTextContent)}</Tag>;
};

export default HeadingBlock;
