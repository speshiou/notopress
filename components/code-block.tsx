import React from "react";
import { renderRichText } from "../lib/render-rich-text";
import { CodeBlockObjectResponse } from "@notionhq/client/build/src/api-endpoints";

function CodeBlock({ block }: { block: CodeBlockObjectResponse }) {
  if (!block || !block.code) {
    // Or handle error appropriately
    return (
      <pre className="bg-gray-100 p-4 rounded-md my-4">
        <code></code>
      </pre>
    );
  }

  const { rich_text, language, caption } = block.code;
  const langClass = language ? `language-${language}` : "";

  // Note: For actual syntax highlighting, a library like Prism.js or highlight.js would be needed,
  // and it would typically operate on the plain_text content of the code block.
  // renderRichText might not be the ideal renderer if complex highlighting is applied,
  // as it wraps text in formatting tags. However, if the code itself contains Notion's
  // rich text annotations (e.g. part of the code is bolded in Notion), renderRichText is appropriate.

  return (
    <div className="my-4">
      {language && (
        <div className="text-sm text-gray-500 bg-gray-200 px-2 py-1 rounded-t-md inline-block">
          {language}
        </div>
      )}
      <pre
        className={`bg-gray-100 p-4 rounded-b-md ${
          language ? "rounded-t-none" : "rounded-md"
        } overflow-x-auto`}
      >
        <code className={langClass}>{renderRichText(rich_text)}</code>
      </pre>
      {caption && caption.length > 0 && (
        <div className="text-sm text-gray-500 italic mt-1">
          {renderRichText(caption)}
        </div>
      )}
    </div>
  );
}

export default CodeBlock;
