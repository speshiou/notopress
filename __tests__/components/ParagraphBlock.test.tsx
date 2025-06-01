import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ParagraphBlock from '@/components/paragraph-block';
import { ParagraphBlockObjectResponse } from '@notionhq/client'; // Using actual type
import { RichTextItemResponse } from '@/lib/render-rich-text'; // Import type for mocking

// Mock the renderRichText utility
jest.mock('@/lib/render-rich-text', () => ({
  ...jest.requireActual('@/lib/render-rich-text'), // Retain RichTextItemResponse type if needed
  renderRichText: jest.fn((richTextArray) =>
    richTextArray.map((rt: RichTextItemResponse) => rt.plain_text).join('')
  ),
}));

describe('ParagraphBlock Component', () => {
  const mockRichText: RichTextItemResponse[] = [
    {
      type: 'text',
      text: { content: 'Hello, ', link: null },
      annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' },
      plain_text: 'Hello, ',
      href: null,
    },
    {
      type: 'text',
      text: { content: 'world!', link: null },
      annotations: { bold: true, italic: false, strikethrough: false, underline: false, code: false, color: 'default' },
      plain_text: 'world!',
      href: null,
    },
  ];

  const mockBlock: ParagraphBlockObjectResponse = {
    id: 'test-paragraph-id',
    type: 'paragraph',
    object: 'block',
    created_time: '2023-01-01T00:00:00Z',
    last_edited_time: '2023-01-01T00:00:00Z',
    created_by: { object: 'user', id: 'user-id' },
    last_edited_by: { object: 'user', id: 'user-id' },
    has_children: false,
    archived: false,
    paragraph: {
      rich_text: mockRichText,
      color: 'default',
    },
  };

  beforeEach(() => {
    // Clear mock calls before each test
    (require('@/lib/render-rich-text').renderRichText as jest.Mock).mockClear();
  });

  test('renders a paragraph tag', () => {
    render(<ParagraphBlock block={mockBlock} />);
    const pElement = screen.getByText((content, element) => element?.tagName.toLowerCase() === 'p');
    expect(pElement).toBeInTheDocument();
  });

  test('calls renderRichText with the correct rich_text data', () => {
    render(<ParagraphBlock block={mockBlock} />);
    expect(require('@/lib/render-rich-text').renderRichText).toHaveBeenCalledWith(mockRichText);
  });

  test('displays the text content processed by renderRichText', () => {
    // The mock for renderRichText joins plain_text, so "Hello, world!"
    render(<ParagraphBlock block={mockBlock} />);
    // Check if the paragraph contains the concatenated plain text from the mock
    expect(screen.getByText('Hello, world!')).toBeInTheDocument();
  });

  test('applies className "text-lg"', () => {
    render(<ParagraphBlock block={mockBlock} />);
    const pElement = screen.getByText('Hello, world!');
    expect(pElement).toHaveClass('text-lg');
  });

  test('renders empty paragraph if rich_text is empty', () => {
    const emptyBlock = {
      ...mockBlock,
      paragraph: {
        ...mockBlock.paragraph,
        rich_text: [],
      },
    };
    (require('@/lib/render-rich-text').renderRichText as jest.Mock).mockReturnValueOnce('');
    render(<ParagraphBlock block={emptyBlock} />);
    const pElement = screen.getByRole('paragraph', { hidden: true }); //getByRole can find p, but if empty, might need different query or check content
    expect(pElement).toBeInTheDocument();
    expect(pElement.textContent).toBe('');
    expect(require('@/lib/render-rich-text').renderRichText).toHaveBeenCalledWith([]);
  });
});
