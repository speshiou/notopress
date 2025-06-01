import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import NumberedListItemBlock from '@/components/numbered-list-item-block';
import { RichTextItemResponse } from '@/lib/render-rich-text';

// Mock the renderRichText utility
jest.mock('@/lib/render-rich-text', () => ({
  ...jest.requireActual('@/lib/render-rich-text'),
  renderRichText: jest.fn((richTextArray) =>
    richTextArray.map((rt: RichTextItemResponse) => rt.plain_text).join('')
  ),
}));

describe('NumberedListItemBlock Component', () => {
  const mockRichText: RichTextItemResponse[] = [
    {
      type: 'text',
      text: { content: 'Numbered list item', link: null },
      annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' },
      plain_text: 'Numbered list item',
      href: null,
    },
  ];

  const mockBlock = {
    id: 'test-numbered-list-item-id',
    type: 'numbered_list_item',
    object: 'block',
    created_time: '2023-01-01T00:00:00Z',
    last_edited_time: '2023-01-01T00:00:00Z',
    created_by: { object: 'user', id: 'user-id' },
    last_edited_by: { object: 'user', id: 'user-id' },
    has_children: false,
    archived: false,
    numbered_list_item: {
      rich_text: mockRichText,
      color: 'default',
    },
  } as any; // Cast as any

  beforeEach(() => {
    (require('@/lib/render-rich-text').renderRichText as jest.Mock).mockClear();
  });

  test('renders an li tag', () => {
    render(<NumberedListItemBlock block={mockBlock} />);
    const liElement = screen.getByRole('listitem');
    expect(liElement).toBeInTheDocument();
  });

  test('calls renderRichText with the correct rich_text data', () => {
    render(<NumberedListItemBlock block={mockBlock} />);
    expect(require('@/lib/render-rich-text').renderRichText).toHaveBeenCalledWith(mockRichText);
  });

  test('displays the text content processed by renderRichText', () => {
    render(<NumberedListItemBlock block={mockBlock} />);
    expect(screen.getByText('Numbered list item')).toBeInTheDocument();
  });

  test('renders an empty li tag if rich_text is empty', () => {
    const emptyBlock = {
      ...mockBlock,
      numbered_list_item: {
        ...mockBlock.numbered_list_item,
        rich_text: [],
      },
    };
    (require('@/lib/render-rich-text').renderRichText as jest.Mock).mockReturnValueOnce('');
    render(<NumberedListItemBlock block={emptyBlock} />);
    const liElement = screen.getByRole('listitem');
    expect(liElement).toBeInTheDocument();
    expect(liElement.textContent).toBe('');
  });

  test('renders an empty li tag if numbered_list_item property is missing', () => {
    const malformedBlock = {
      ...mockBlock,
      numbered_list_item: undefined,
    };
    render(<NumberedListItemBlock block={malformedBlock} />);
    const liElement = screen.getByRole('listitem');
    expect(liElement).toBeInTheDocument();
    expect(liElement.textContent).toBe('');
  });
});
