import React from 'react';
// waitFor is still useful, but findBy* queries are often preferred for async content
import { render, screen, waitFor, findByTestId, findByText } from '@testing-library/react';
import '@testing-library/jest-dom';
import NotionPage from '@/components/server/notion-page'; // Updated import path for NotionPage
import { fetchPageBlocks } from '@/lib/notion';

// Mock the fetchPageBlocks function from lib/notion
jest.mock('@/lib/notion', () => ({
  ...jest.requireActual('@/lib/notion'),
  fetchPageBlocks: jest.fn(),
}));
// Cast fetchPageBlocks to its mock type for easier use
const mockedFetchPageBlocks = fetchPageBlocks as jest.Mock;

// Mock child components to simplify testing NotionPage itself
// We are testing that NotionPage passes the correct props, not the full render of children here.
jest.mock('@/components/paragraph-block', () => (props) => <div data-testid="paragraph-block">{JSON.stringify(props.block.id)}</div>);
jest.mock('@/components/heading-block', () => (props) => <div data-testid="heading-block">{JSON.stringify(props.block.id)}</div>);
jest.mock('@/components/image-block', () => (props) => <div data-testid="image-block">{JSON.stringify(props.block.id)}</div>);
jest.mock('@/components/bulleted-list-item-block', () => (props) => <div data-testid="bulleted-list-item-block">{JSON.stringify(props.block.id)}</div>);
jest.mock('@/components/numbered-list-item-block', () => (props) => <div data-testid="numbered-list-item-block">{JSON.stringify(props.block.id)}</div>);
jest.mock('@/components/quote-block', () => (props) => <div data-testid="quote-block">{JSON.stringify(props.block.id)}</div>);
jest.mock('@/components/code-block', () => (props) => <div data-testid="code-block">{JSON.stringify(props.block.id)}</div>);


// Mock @notionhq/client's isFullBlock for consistent behavior in tests
jest.mock('@notionhq/client', () => ({
  ...jest.requireActual('@notionhq/client'),
  isFullBlock: jest.fn((block) => true), // Assume all blocks are full for these tests
}));


describe('NotionPage Component', () => {
  const mockPageId = 'test-page-id';

  beforeEach(() => {
    // Reset mocks before each test
    (fetchPageBlocks as jest.Mock).mockReset();
    // Reset mocks before each test
    mockedFetchPageBlocks.mockReset();
    // Reset isFullBlock mock
    require('@notionhq/client').isFullBlock.mockClear();
  });

  // Removed 'renders loading state initially' test as it's not applicable to async Server Components
  // in the same way. The component now resolves data server-side before rendering or suspends.

  test('renders blocks correctly after successful fetching', async () => {
    const mockBlocks = [
      { id: 'block-1', type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Hello' }] } },
      { id: 'block-2', type: 'heading_1', heading_1: { rich_text: [{ plain_text: 'Title' }] } },
      // Add other representative mock blocks as needed
    ];
    mockedFetchPageBlocks.mockResolvedValue(mockBlocks);

    // Render the async component. Note: `render` itself is not async for server components this way,
    // but the effects of the async operations within it will be reflected in the DOM over time.
    // We use findBy* queries or waitFor to handle the async nature of content appearance.
    const { container } = render(<NotionPage pageId={mockPageId} />);

    // Use findBy* queries which wait for the element to appear
    expect(await findByTestId(container, 'paragraph-block')).toHaveTextContent('block-1');
    expect(await findByTestId(container, 'heading-block')).toHaveTextContent('block-2');
  });

  test('renders error message if fetchPageBlocks fails', async () => {
    mockedFetchPageBlocks.mockRejectedValue(new Error('Failed to fetch'));

    const { container } = render(<NotionPage pageId={mockPageId} />);

    // Check for the error message
    expect(await findByText(container, 'Error: Failed to fetch page content.')).toBeInTheDocument();
  });

  test('renders "no blocks found" message if fetchPageBlocks returns empty array', async () => {
    mockedFetchPageBlocks.mockResolvedValue([]);

    const { container } = render(<NotionPage pageId={mockPageId} />);

    expect(await findByText(container, 'No blocks found for this page.')).toBeInTheDocument();
  });

   test('renders "no blocks found" message if fetchPageBlocks returns null', async () => {
    mockedFetchPageBlocks.mockResolvedValue(null);

    const { container } = render(<NotionPage pageId={mockPageId} />);

    expect(await findByText(container, 'No blocks found for this page.')).toBeInTheDocument();
  });

  test('calls isFullBlock for each block when blocks are successfully rendered', async () => {
    const mockBlocks = [
      { id: 'b1', type: 'paragraph', paragraph: { rich_text: [] } },
      { id: 'b2', type: 'heading_1', heading_1: { rich_text: [] } },
    ];
    mockedFetchPageBlocks.mockResolvedValue(mockBlocks);
    const isFullBlockMock = require('@notionhq/client').isFullBlock;

    render(<NotionPage pageId={mockPageId} />);

    // Wait for blocks to be processed and rendered
    await waitFor(() => {
      // Check if paragraph block (or any block) is rendered to ensure map function was called
      expect(screen.getByTestId('paragraph-block')).toBeInTheDocument();
    });

    expect(isFullBlockMock).toHaveBeenCalledTimes(mockBlocks.length);
    expect(isFullBlockMock).toHaveBeenCalledWith(mockBlocks[0]);
    expect(isFullBlockMock).toHaveBeenCalledWith(mockBlocks[1]);
  });
});
