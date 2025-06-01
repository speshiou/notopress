import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import HeadingBlock from '@/components/heading-block';
import { RichTextItemResponse } from '@/lib/render-rich-text'; // Import type for mocking

// Mock the renderRichText utility
jest.mock('@/lib/render-rich-text', () => ({
  ...jest.requireActual('@/lib/render-rich-text'),
  renderRichText: jest.fn((richTextArray) =>
    richTextArray.map((rt: RichTextItemResponse) => rt.plain_text).join('')
  ),
}));

describe('HeadingBlock Component', () => {
  const mockRichText: RichTextItemResponse[] = [
    {
      type: 'text',
      text: { content: 'Test Heading', link: null },
      annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' },
      plain_text: 'Test Heading',
      href: null,
    },
  ];

  const baseMockBlock = {
    id: 'test-heading-id',
    object: 'block',
    created_time: '2023-01-01T00:00:00Z',
    last_edited_time: '2023-01-01T00:00:00Z',
    created_by: { object: 'user', id: 'user-id' },
    last_edited_by: { object: 'user', id: 'user-id' },
    has_children: false,
    archived: false,
  };

  beforeEach(() => {
    (require('@/lib/render-rich-text').renderRichText as jest.Mock).mockClear();
  });

  test('renders H1 for heading_1 type', () => {
    const mockBlock = {
      ...baseMockBlock,
      type: 'heading_1',
      heading_1: { rich_text: mockRichText, color: 'default', is_toggleable: false },
    } as any; // Cast as any to satisfy broader block type, focusing on HeadingBlockProps
    render(<HeadingBlock block={mockBlock} />);
    const h1Element = screen.getByRole('heading', { level: 1 });
    expect(h1Element).toBeInTheDocument();
    expect(h1Element.textContent).toBe('Test Heading');
    expect(require('@/lib/render-rich-text').renderRichText).toHaveBeenCalledWith(mockRichText);
  });

  test('renders H2 for heading_2 type', () => {
    const mockBlock = {
      ...baseMockBlock,
      type: 'heading_2',
      heading_2: { rich_text: mockRichText, color: 'default', is_toggleable: false },
    } as any;
    render(<HeadingBlock block={mockBlock} />);
    const h2Element = screen.getByRole('heading', { level: 2 });
    expect(h2Element).toBeInTheDocument();
    expect(h2Element.textContent).toBe('Test Heading');
  });

  test('renders H3 for heading_3 type', () => {
    const mockBlock = {
      ...baseMockBlock,
      type: 'heading_3',
      heading_3: { rich_text: mockRichText, color: 'default', is_toggleable: false },
    } as any;
    render(<HeadingBlock block={mockBlock} />);
    const h3Element = screen.getByRole('heading', { level: 3 });
    expect(h3Element).toBeInTheDocument();
    expect(h3Element.textContent).toBe('Test Heading');
  });

  test('renders empty heading tag if rich_text is empty for heading_1', () => {
    const mockBlock = {
      ...baseMockBlock,
      type: 'heading_1',
      heading_1: { rich_text: [], color: 'default', is_toggleable: false },
    } as any;
    (require('@/lib/render-rich-text').renderRichText as jest.Mock).mockReturnValueOnce('');
    render(<HeadingBlock block={mockBlock} />);
    const h1Element = screen.getByRole('heading', { level: 1 });
    expect(h1Element).toBeInTheDocument();
    expect(h1Element.textContent).toBe('');
  });

  test('returns fallback for unsupported heading type if logic allowed it (though types prevent it)', () => {
    const mockBlock = {
      ...baseMockBlock,
      type: 'heading_4', // Invalid type based on component's props
    } as any;
     render(<HeadingBlock block={mockBlock} />);
    // The component currently renders <p>Unsupported heading type</p>
    // Or based on stricter typing, it might not even compile or might throw error if type is not one of h1,h2,h3
    // Current implementation defaults to <p>
    expect(screen.getByText('Unsupported heading type')).toBeInTheDocument();
  });


  test('returns null if block itself is null/undefined (though TypeScript should prevent)', () => {
    // @ts-ignore to test invalid prop
    const { container } = render(<HeadingBlock block={null} />);
    expect(container.firstChild).toBeNull();
  });

  test('returns H1 with no content if heading_1 object is missing (though TypeScript should prevent)', () => {
    const mockBlock = {
      ...baseMockBlock,
      type: 'heading_1',
      // heading_1 property is missing
    } as any;
    render(<HeadingBlock block={mockBlock} />);
    const h1Element = screen.getByRole('heading', { level: 1 });
    expect(h1Element).toBeInTheDocument();
    expect(h1Element.textContent).toBe('');
  });

});
