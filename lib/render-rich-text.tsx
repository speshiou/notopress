import React from 'react';

// It's better to use types from @notionhq/client (e.g., RichTextItemResponse)
// if the project has them fully integrated and these types are exported.
// For now, defining a local interface.
export interface RichTextItemResponse {
  type: 'text' | 'mention' | 'equation';
  plain_text: string;
  annotations: {
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    underline: boolean;
    code: boolean;
    color: string; // e.g., "default", "gray", "brown", "red_background"
  };
  text?: {
    content: string;
    link?: { url: string } | null;
  };
  href?: string | null;
}

export const renderRichText = (richTextArray: RichTextItemResponse[] | undefined) => {
  if (!richTextArray) {
    return null;
  }

  return richTextArray.map((richText, index) => {
    let element: JSX.Element = <>{richText.plain_text}</>;

    // Apply link if present
    if (richText.text?.link?.url) {
      element = <a href={richText.text.link.url} target="_blank" rel="noopener noreferrer">{element}</a>;
    } else if (richText.href) {
      // Handles mentions, which might have an href
      element = <a href={richText.href} target="_blank" rel="noopener noreferrer">{element}</a>;
    }

    // Apply annotations
    if (richText.annotations.bold) {
      element = <strong>{element}</strong>;
    }
    if (richText.annotations.italic) {
      element = <em>{element}</em>;
    }
    if (richText.annotations.strikethrough) {
      element = <s>{element}</s>;
    }
    if (richText.annotations.underline) {
      element = <u>{element}</u>;
    }
    if (richText.annotations.code) {
      element = <code>{element}</code>;
    }
    if (richText.annotations.color && richText.annotations.color !== 'default') {
      // Basic color handling: apply as inline style.
      // More sophisticated mapping to CSS classes might be desired for production.
      const style: React.CSSProperties = {};
      if (richText.annotations.color.includes('_background')) {
        style.backgroundColor = richText.annotations.color.replace('_background', '');
      } else {
        style.color = richText.annotations.color;
      }
      element = <span style={style}>{element}</span>;
    }

    return <React.Fragment key={index}>{element}</React.Fragment>;
  });
};

// It might be useful to also export a function that returns a string
export const richTextToString = (richTextArray: RichTextItemResponse[] | undefined): string => {
  if (!richTextArray) {
    return "";
  }
  return richTextArray.map(rt => rt.plain_text).join('');
};
