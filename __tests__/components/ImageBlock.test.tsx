import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ImageBlock from '@/components/image-block';
import { ImageBlockObjectResponse } from '@notionhq/client'; // Using actual type

// Mock next/image
jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: any) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} />;
  },
}));

describe('ImageBlock Component', () => {
  const baseMockBlock = {
    id: 'test-image-id',
    type: 'image',
    object: 'block',
    created_time: '2023-01-01T00:00:00Z',
    last_edited_time: '2023-01-01T00:00:00Z',
    created_by: { object: 'user', id: 'user-id' },
    last_edited_by: { object: 'user', id: 'user-id' },
    has_children: false,
    archived: false,
  };

  test('renders an image with external URL and caption', () => {
    const mockBlock: ImageBlockObjectResponse = {
      ...baseMockBlock,
      image: {
        type: 'external',
        external: { url: 'http://example.com/image.png' },
        caption: [{ type: 'text', text: { content: 'Test Caption', link: null }, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }, plain_text: 'Test Caption', href: null }],
      },
    };
    render(<ImageBlock block={mockBlock} />);

    const imgElement = screen.getByRole('img');
    expect(imgElement).toBeInTheDocument();
    expect(imgElement).toHaveAttribute('src', 'http://example.com/image.png');
    expect(imgElement).toHaveAttribute('alt', 'Test Caption');

    const figcaptionElement = screen.getByText('Test Caption');
    expect(figcaptionElement).toBeInTheDocument();
    expect(figcaptionElement.tagName.toLowerCase()).toBe('figcaption');
  });

  test('renders an image with file URL and no caption', () => {
    const mockBlock: ImageBlockObjectResponse = {
      ...baseMockBlock,
      image: {
        type: 'file',
        file: { url: '/uploads/image.jpg', expiry_time: '2023-12-31T23:59:59Z' },
        caption: [], // Empty caption
      },
    };
    render(<ImageBlock block={mockBlock} />);

    const imgElement = screen.getByRole('img');
    expect(imgElement).toBeInTheDocument();
    expect(imgElement).toHaveAttribute('src', '/uploads/image.jpg');
    expect(imgElement).toHaveAttribute('alt', ''); // Empty alt when no caption

    // Check that figcaption is not rendered
    const figcaptionElement = screen.queryByRole('caption'); // queryByRole for non-existence
    expect(figcaptionElement).not.toBeInTheDocument();
  });

  test('renders an image with default dimensions from component', () => {
    const mockBlock: ImageBlockObjectResponse = {
      ...baseMockBlock,
      image: {
        type: 'external',
        external: { url: 'http://example.com/image.png' },
        caption: [],
      },
    };
    render(<ImageBlock block={mockBlock} />);
    const imgElement = screen.getByRole('img');
    expect(imgElement).toHaveAttribute('width', '800'); // Default width in component
    expect(imgElement).toHaveAttribute('height', '600'); // Default height in component
    expect(imgElement).toHaveClass('max-w-full');
    expect(imgElement).toHaveStyle('height: auto');
  });

  test('handles caption with multiple rich text elements', () => {
     const mockBlock: ImageBlockObjectResponse = {
      ...baseMockBlock,
      image: {
        type: 'external',
        external: { url: 'http://example.com/image.png' },
        caption: [
            { type: 'text', text: { content: 'Part 1. ', link: null }, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }, plain_text: 'Part 1. ', href: null },
            { type: 'text', text: { content: 'Part 2.', link: null }, annotations: { bold: true, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }, plain_text: 'Part 2.', href: null }
        ],
      },
    };
    render(<ImageBlock block={mockBlock} />);
    const imgElement = screen.getByRole('img');
    // The component joins plain_text for alt and figcaption
    expect(imgElement).toHaveAttribute('alt', 'Part 1. Part 2.');
    expect(screen.getByText('Part 1. Part 2.')).toBeInTheDocument();
  });
});
