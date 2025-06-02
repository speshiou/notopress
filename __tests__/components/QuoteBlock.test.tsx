import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import QuoteBlock from "@/components/quote-block";
import { RichTextItemResponse } from "@/components/rich-text";

// Mock the renderRichText utility
jest.mock("@/lib/render-rich-text", () => ({
  ...jest.requireActual("@/lib/render-rich-text"),
  renderRichText: jest.fn((richTextArray) =>
    richTextArray.map((rt: RichTextItemResponse) => rt.plain_text).join("")
  ),
}));

describe("QuoteBlock Component", () => {
  const mockRichText: RichTextItemResponse[] = [
    {
      type: "text",
      text: { content: "This is a quote.", link: null },
      annotations: {
        bold: false,
        italic: false,
        strikethrough: false,
        underline: false,
        code: false,
        color: "default",
      },
      plain_text: "This is a quote.",
      href: null,
    },
  ];

  const mockBlock = {
    id: "test-quote-id",
    type: "quote",
    object: "block",
    created_time: "2023-01-01T00:00:00Z",
    last_edited_time: "2023-01-01T00:00:00Z",
    created_by: { object: "user", id: "user-id" },
    last_edited_by: { object: "user", id: "user-id" },
    has_children: false, // Assuming no nested blocks for this basic test
    archived: false,
    quote: {
      rich_text: mockRichText,
      color: "default",
    },
  } as any; // Cast as any

  beforeEach(() => {
    (require("@/lib/render-rich-text").renderRichText as jest.Mock).mockClear();
  });

  test("renders a blockquote tag", () => {
    render(<QuoteBlock block={mockBlock} />);
    const bqElement = screen.getByRole("blockquote");
    expect(bqElement).toBeInTheDocument();
  });

  test("calls renderRichText with the correct rich_text data", () => {
    render(<QuoteBlock block={mockBlock} />);
    expect(
      require("@/lib/render-rich-text").renderRichText
    ).toHaveBeenCalledWith(mockRichText);
  });

  test("displays the text content processed by renderRichText", () => {
    render(<QuoteBlock block={mockBlock} />);
    expect(screen.getByText("This is a quote.")).toBeInTheDocument();
  });

  test("applies correct Tailwind classes for styling", () => {
    render(<QuoteBlock block={mockBlock} />);
    const bqElement = screen.getByRole("blockquote");
    expect(bqElement).toHaveClass(
      "border-l-4 border-gray-300 pl-4 italic my-4"
    );
  });

  test("renders an empty blockquote if rich_text is empty", () => {
    const emptyBlock = {
      ...mockBlock,
      quote: {
        ...mockBlock.quote,
        rich_text: [],
      },
    };
    (
      require("@/lib/render-rich-text").renderRichText as jest.Mock
    ).mockReturnValueOnce("");
    render(<QuoteBlock block={emptyBlock} />);
    const bqElement = screen.getByRole("blockquote");
    expect(bqElement).toBeInTheDocument();
    expect(bqElement.textContent).toBe("");
  });

  test("renders an empty blockquote if quote property is missing", () => {
    const malformedBlock = {
      ...mockBlock,
      quote: undefined,
    };
    render(<QuoteBlock block={malformedBlock} />);
    const bqElement = screen.getByRole("blockquote");
    expect(bqElement).toBeInTheDocument();
    expect(bqElement.textContent).toBe("");
  });
});
