import { POST } from '@/app/api/revalidate/route'; // Adjust if your actual path is different
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';

// Mock next/cache
jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}));

// Helper to create a mock NextRequest
const createMockRequest = (body: any, headers?: HeadersInit): NextRequest => {
  const req = new Request('http://localhost/api/revalidate', {
    method: 'POST',
    headers: new Headers(headers),
    body: JSON.stringify(body),
  });
  return req as NextRequest;
};

const MOCK_SECRET_TOKEN = 'test-secret-token';

describe('/api/revalidate webhook', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment variables
    originalEnv = { ...process.env };
    // Set the mock secret token for tests
    process.env.WEBHOOK_SECRET_TOKEN = MOCK_SECRET_TOKEN;
    // Reset mocks before each test
    (revalidatePath as jest.Mock).mockClear();
  });

  afterEach(() => {
    // Restore original environment variables
    process.env = originalEnv;
  });

  describe('Authorization', () => {
    it('should return 401 if Authorization header is missing', async () => {
      const request = createMockRequest({ event_type: 'page_updated', page_id: '123' });
      const response = await POST(request);
      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.message).toBe('Authorization header missing');
    });

    it('should return 401 if Authorization scheme is not Bearer', async () => {
      const request = createMockRequest(
        { event_type: 'page_updated', page_id: '123' },
        { Authorization: `Basic ${MOCK_SECRET_TOKEN}` }
      );
      const response = await POST(request);
      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.message).toBe('Invalid token');
    });

    it('should return 401 if token is invalid', async () => {
      const request = createMockRequest(
        { event_type: 'page_updated', page_id: '123' },
        { Authorization: 'Bearer invalid-token' }
      );
      const response = await POST(request);
      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.message).toBe('Invalid token');
    });

    it('should return 500 if WEBHOOK_SECRET_TOKEN is not set in environment', async () => {
      delete process.env.WEBHOOK_SECRET_TOKEN; // Simulate missing env var
      const request = createMockRequest(
        { event_type: 'page_updated', page_id: '123' },
        { Authorization: `Bearer ${MOCK_SECRET_TOKEN}` }
      );
      const response = await POST(request);
      expect(response.status).toBe(500);
      const json = await response.json();
      expect(json.message).toBe('Webhook misconfigured. Secret token not set.');
    });
  });

  describe('Payload Validation', () => {
    it('should return 400 if payload is not valid JSON', async () => {
        const req = new Request('http://localhost/api/revalidate', {
        method: 'POST',
        headers: new Headers({ Authorization: `Bearer ${MOCK_SECRET_TOKEN}` }),
        body: 'not-json',
      });
      const response = await POST(req as NextRequest);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.message).toBe('Invalid JSON payload');
    });

    it('should return 400 if event_type is missing', async () => {
      const request = createMockRequest(
        { page_id: '123' }, // Missing event_type
        { Authorization: `Bearer ${MOCK_SECRET_TOKEN}` }
      );
      const response = await POST(request);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.message).toBe('Missing event_type or page_id in payload');
    });

    it('should return 400 if page_id is missing', async () => {
      const request = createMockRequest(
        { event_type: 'page_updated' }, // Missing page_id
        { Authorization: `Bearer ${MOCK_SECRET_TOKEN}` }
      );
      const response = await POST(request);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.message).toBe('Missing event_type or page_id in payload');
    });

    it('should return 400 for unknown event_type', async () => {
      const request = createMockRequest(
        { event_type: 'unknown_event', page_id: '123' },
        { Authorization: `Bearer ${MOCK_SECRET_TOKEN}` }
      );
      const response = await POST(request);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.message).toBe('Unknown event_type');
    });
  });

  describe('Successful Event Handling', () => {
    const testCases = [
      { event: 'page_created', pageId: 'page-created-id', expectedMessage: 'Revalidated /post/page-created-id for event: page_created'},
      { event: 'page_updated', pageId: 'page-updated-id', expectedMessage: 'Revalidated /post/page-updated-id for event: page_updated'},
      { event: 'page_deleted', pageId: 'page-deleted-id', expectedMessage: 'Path /post/page-deleted-id revalidation triggered for event: page_deleted'},
    ];

    testCases.forEach(({ event, pageId, expectedMessage }) => {
      it(`should handle ${event} event and call revalidatePath`, async () => {
        const request = createMockRequest(
          { event_type: event, page_id: pageId },
          { Authorization: `Bearer ${MOCK_SECRET_TOKEN}` }
        );
        const response = await POST(request);
        expect(response.status).toBe(200);
        const json = await response.json();
        expect(json.message).toBe(expectedMessage);
        expect(revalidatePath).toHaveBeenCalledWith(`/post/${pageId}`);
      });
    });

    it('should return 500 if revalidatePath throws an error', async () => {
      (revalidatePath as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Revalidation failed');
      });
      const request = createMockRequest(
        { event_type: 'page_updated', page_id: '123' },
        { Authorization: `Bearer ${MOCK_SECRET_TOKEN}` }
      );
      const response = await POST(request);
      expect(response.status).toBe(500);
      const json = await response.json();
      expect(json.message).toBe('Error during revalidation');
    });
  });
});
