import React from "react";
import { RichText } from "./rich-text";
import { CodeBlockObjectResponse } from "@notionhq/client/build/src/api-endpoints";

function CodeBlock({ block }: { block: CodeBlockObjectResponse }) {
  if (!block || !block.code) {
    return (
      <pre className="bg-base-200 p-4 rounded-md my-4">
        <code></code>
      </pre>
    );
  }

  const { rich_text, language, caption } = block.code;
  const langClass = language ? `language-${language}` : "";

  return (
    <div className="my-4">
      {language && (
        <div className="text-xs text-base-content/60 bg-base-300 px-2 py-1 rounded-t-md inline-block">
          {language}
        </div>
      )}
      <pre
        className={`bg-base-200 p-4 rounded-b-md ${
          language ? "rounded-t-none" : "rounded-md"
        } overflow-x-auto`}
      >
        <code className={langClass}>
          <RichText richTextArray={rich_text} />
        </code>
      </pre>
      {caption && caption.length > 0 && (
        <div className="text-xs text-base-content/60 italic mt-1">
          <RichText richTextArray={caption} />
        </div>
      )}
    </div>
  );
}

export default CodeBlock;
