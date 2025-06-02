import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import BulletedListItemBlock from "@/components/bulleted-list-item-block";
import { RichTextItemResponse } from "@/components/rich-text";

// Mock the renderRichText utility
jest.mock("@/lib/render-rich-text", () => ({
  ...jest.requireActual("@/lib/render-rich-text"),
  renderRichText: jest.fn((richTextArray) =>
    richTextArray.map((rt: RichTextItemResponse) => rt.plain_text).join("")
  ),
}));

describe("BulletedListItemBlock Component", () => {
  const mockRichText: RichTextItemResponse[] = [
    {
      type: "text",
      text: { content: "List item text", link: null },
      annotations: {
        bold: false,
        italic: false,
        strikethrough: false,
        underline: false,
        code: false,
        color: "default",
      },
      plain_text: "List item text",
      href: null,
    },
  ];

  const mockBlock = {
    id: "test-bulleted-list-item-id",
    type: "bulleted_list_item",
    object: "block",
    created_time: "2023-01-01T00:00:00Z",
    last_edited_time: "2023-01-01T00:00:00Z",
    created_by: { object: "user", id: "user-id" },
    last_edited_by: { object: "user", id: "user-id" },
    has_children: false, // Assuming no nested lists for this basic test
    archived: false,
    bulleted_list_item: {
      rich_text: mockRichText,
      color: "default",
    },
  } as any; // Cast as any to satisfy broader block type

  beforeEach(() => {
    (require("@/lib/render-rich-text").renderRichText as jest.Mock).mockClear();
  });

  test("renders an li tag", () => {
    render(<BulletedListItemBlock block={mockBlock} />);
    const liElement = screen.getByRole("listitem");
    expect(liElement).toBeInTheDocument();
  });

  test("calls renderRichText with the correct rich_text data", () => {
    render(<BulletedListItemBlock block={mockBlock} />);
    expect(
      require("@/lib/render-rich-text").renderRichText
    ).toHaveBeenCalledWith(mockRichText);
  });

  test("displays the text content processed by renderRichText", () => {
    render(<BulletedListItemBlock block={mockBlock} />);
    expect(screen.getByText("List item text")).toBeInTheDocument();
  });

  test("renders an empty li tag if rich_text is empty", () => {
    const emptyBlock = {
      ...mockBlock,
      bulleted_list_item: {
        ...mockBlock.bulleted_list_item,
        rich_text: [],
      },
    };
    (
      require("@/lib/render-rich-text").renderRichText as jest.Mock
    ).mockReturnValueOnce("");
    render(<BulletedListItemBlock block={emptyBlock} />);
    const liElement = screen.getByRole("listitem");
    expect(liElement).toBeInTheDocument();
    expect(liElement.textContent).toBe("");
  });

  test("renders an empty li tag if bulleted_list_item property is missing", () => {
    const malformedBlock = {
      ...mockBlock,
      bulleted_list_item: undefined,
    };
    render(<BulletedListItemBlock block={malformedBlock} />);
    const liElement = screen.getByRole("listitem");
    expect(liElement).toBeInTheDocument();
    expect(liElement.textContent).toBe("");
  });

  // Note: Testing nested lists (children) would require more complex mocking and setup
  // if the component were to support rendering them. Current component does not.
});
