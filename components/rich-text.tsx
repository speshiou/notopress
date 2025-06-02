import { RichTextItemResponse } from "@notionhq/client";
import React from "react";

export const RichText = ({
  richTextArray,
}: {
  richTextArray: RichTextItemResponse[] | undefined;
}) => {
  if (!richTextArray) {
    return null;
  }

  return (
    <>
      {richTextArray.map((richText, index) => {
        let element: React.ReactNode;

        switch (richText.type) {
          case "text":
            element = richText.plain_text;
            // Apply link if present
            if (richText.text?.link?.url) {
              element = (
                <a
                  href={richText.text.link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {element}
                </a>
              );
            }
            break;
          case "mention":
            // Mentions may have a href or fallback to plain_text
            if (richText.href) {
              element = (
                <a
                  href={richText.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {richText.plain_text}
                </a>
              );
            } else {
              element = richText.plain_text;
            }
            break;
          case "equation":
            // For equations, you might want to render with MathJax or similar
            element = <code>{richText.plain_text}</code>;
            break;
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
        if (
          richText.annotations.color &&
          richText.annotations.color !== "default"
        ) {
          const style: React.CSSProperties = {};
          if (richText.annotations.color.includes("_background")) {
            style.backgroundColor = richText.annotations.color.replace(
              "_background",
              ""
            );
          } else {
            style.color = richText.annotations.color;
          }
          element = <span style={style}>{element}</span>;
        }

        return <React.Fragment key={index}>{element}</React.Fragment>;
      })}
    </>
  );
};

// It might be useful to also export a function that returns a string
export const richTextToString = (
  richTextArray: RichTextItemResponse[] | undefined
): string => {
  if (!richTextArray) {
    return "";
  }
  return richTextArray.map((rt) => rt.plain_text).join("");
};
