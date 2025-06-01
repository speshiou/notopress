import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import CodeBlock from "@/components/code-block";
import { RichTextItemResponse } from "@/components/rich-text";

// Mock the renderRichText utility
jest.mock("@/lib/render-rich-text", () => ({
  ...jest.requireActual("@/lib/render-rich-text"),
  renderRichText: jest.fn((richTextArray) => {
    if (!richTextArray) return "";
    return richTextArray
      .map((rt: RichTextItemResponse) => rt.plain_text)
      .join("");
  }),
}));

describe("CodeBlock Component", () => {
  const mockCodeRichText: RichTextItemResponse[] = [
    {
      type: "text",
      text: { content: 'console.log("Hello, Code!");', link: null },
      annotations: {
        bold: false,
        italic: false,
        strikethrough: false,
        underline: false,
        code: false,
        color: "default",
      },
      plain_text: 'console.log("Hello, Code!");',
      href: null,
    },
  ];

  const mockCaptionRichText: RichTextItemResponse[] = [
    {
      type: "text",
      text: { content: "This is a code caption.", link: null },
      annotations: {
        bold: false,
        italic: true,
        strikethrough: false,
        underline: false,
        code: false,
        color: "default",
      },
      plain_text: "This is a code caption.",
      href: null,
    },
  ];

  const baseMockBlock = {
    id: "test-code-id",
    type: "code",
    object: "block",
    created_time: "2023-01-01T00:00:00Z",
    last_edited_time: "2023-01-01T00:00:00Z",
    created_by: { object: "user", id: "user-id" },
    last_edited_by: { object: "user", id: "user-id" },
    has_children: false,
    archived: false,
  } as const;

  const mockBlock = {
    ...baseMockBlock,
    code: {
      rich_text: mockCodeRichText,
      language: "javascript",
      caption: mockCaptionRichText,
    },
  } as any; // Cast as any

  const mockBlockNoLangNoCaption = {
    ...baseMockBlock,
    id: "test-code-id-2", // Ensure different ID if used in same describe block without cleaning up DOM
    code: {
      rich_text: mockCodeRichText,
      // language missing
      // caption missing
    },
  } as any;

  beforeEach(() => {
    (require("@/lib/render-rich-text").renderRichText as jest.Mock).mockClear();
  });

  test("renders pre and code tags", () => {
    render(<CodeBlock block={mockBlock} />);
    const preElement = screen.getByRole("complementary"); // <pre> is often mapped to 'complementary' or group role by AT
    const codeElement = screen.getByRole("code"); // <code> element

    // More specific query if role is not specific enough or changes
    // const preElement = container.querySelector('pre');
    // const codeElement = container.querySelector('code');

    expect(preElement).toBeInTheDocument();
    expect(codeElement).toBeInTheDocument();
    expect(preElement).toContainElement(codeElement);
  });

  test("displays the language and caption when provided", () => {
    render(<CodeBlock block={mockBlock} />);
    expect(screen.getByText("javascript")).toBeInTheDocument();
    expect(screen.getByText("This is a code caption.")).toBeInTheDocument();

    // Check renderRichText was called for both code and caption
    const renderRichTextMock = require("@/lib/render-rich-text").renderRichText;
    expect(renderRichTextMock).toHaveBeenCalledWith(mockCodeRichText);
    expect(renderRichTextMock).toHaveBeenCalledWith(mockCaptionRichText);
  });

  test("displays the code content processed by renderRichText", () => {
    render(<CodeBlock block={mockBlock} />);
    // Check if the code element contains the concatenated plain text
    expect(screen.getByRole("code")).toHaveTextContent(
      'console.log("Hello, Code!");'
    );
  });

  test("applies language class to code tag", () => {
    render(<CodeBlock block={mockBlock} />);
    expect(screen.getByRole("code")).toHaveClass("language-javascript");
  });

  test("does not display language or caption if not provided", () => {
    render(<CodeBlock block={mockBlockNoLangNoCaption} />);
    expect(screen.queryByText("javascript")).not.toBeInTheDocument();
    expect(
      screen.queryByText("This is a code caption.")
    ).not.toBeInTheDocument();
    expect(screen.getByRole("code")).not.toHaveClass("language-javascript"); // No class if no language
  });

  test("renders empty pre/code if rich_text is empty", () => {
    const emptyCodeBlock = {
      ...baseMockBlock,
      id: "test-code-id-empty",
      code: { rich_text: [], language: "text" },
    } as any;
    (
      require("@/lib/render-rich-text").renderRichText as jest.Mock
    ).mockReturnValueOnce("");
    render(<CodeBlock block={emptyCodeBlock} />);
    const codeElement = screen.getByRole("code");
    expect(codeElement).toBeInTheDocument();
    expect(codeElement.textContent).toBe("");
  });

  test("renders empty pre/code if code property is missing", () => {
    const malformedBlock = {
      ...baseMockBlock,
      id: "test-code-id-malformed",
      code: undefined,
    } as any;
    render(<CodeBlock block={malformedBlock} />);
    const codeElement = screen.getByRole("code"); // It will render the fallback empty pre/code
    expect(codeElement).toBeInTheDocument();
    expect(codeElement.textContent).toBe("");
  });
});
