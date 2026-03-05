import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RTClient } from '../rt-client.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
  });
}

describe('RTClient', () => {
  let client: RTClient;

  beforeEach(() => {
    client = new RTClient('http://rt.example.com', 'test-token');
    mockFetch.mockReset();
  });

  describe('headers and URL construction', () => {
    it('sets auth and content-type headers', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ items: [] }));
      await client.searchTickets('id > 0');

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = options.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('token test-token');
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Accept']).toBe('application/json');
    });

    it('strips trailing slash from base URL', async () => {
      const client2 = new RTClient('http://rt.example.com/', 'token');
      mockFetch.mockReturnValueOnce(mockResponse({ items: [] }));
      await client2.searchTickets('id > 0');

      const [url] = mockFetch.mock.calls[0] as [string];
      const parsed = new URL(url);
      expect(parsed.hostname).toBe('rt.example.com');
      expect(parsed.pathname).not.toMatch(/\/\//);
    });
  });

  describe('searchTickets', () => {
    it('calls the correct endpoint with query', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ count: 0, items: [] }));
      await client.searchTickets("Status = 'open'");

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('/REST/2.0/tickets');
      expect(url).toContain('query=');
    });

    it('passes pagination options', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ count: 0, items: [] }));
      await client.searchTickets('id > 0', { per_page: 5, page: 2, order: 'DESC', orderby: 'Created' });

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('per_page=5');
      expect(url).toContain('page=2');
      expect(url).toContain('order=DESC');
      expect(url).toContain('orderby=Created');
    });

    it('passes fields param in URL', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ count: 0, items: [] }));
      await client.searchTickets('id > 0', { fields: 'Subject,Status' });

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('fields=Subject%2CStatus');
    });
  });

  describe('getTicket', () => {
    it('passes fields param in URL', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ id: 1 }));
      await client.getTicket(1, { fields: 'Owner,Requestors' });

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('fields=');
    });

    it('calls the correct endpoint', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ id: 42, type: 'ticket' }));
      const result = await client.getTicket(42);

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('/REST/2.0/ticket/42');
      expect(result).toMatchObject({ id: 42 });
    });
  });

  describe('createTicket', () => {
    it('POSTs to the correct endpoint with body', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ id: 1 }));
      await client.createTicket({ Queue: 'General', Subject: 'Test' });

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/REST/2.0/ticket');
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body as string)).toMatchObject({
        Queue: 'General',
        Subject: 'Test',
      });
    });
  });

  describe('updateTicket', () => {
    it('PUTs to the correct endpoint', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(['Status changed']));
      await client.updateTicket(7, { Status: 'resolved' });

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/REST/2.0/ticket/7');
      expect(options.method).toBe('PUT');
    });
  });

  describe('getTransaction', () => {
    it('fetches transaction and decodes text attachment content', async () => {
      const encoded = Buffer.from('Hello world').toString('base64');
      mockFetch
        .mockReturnValueOnce(mockResponse({
          id: 99,
          Type: 'Correspond',
          _hyperlinks: [{ ref: 'attachment', id: 5, _url: 'http://example.com/attachment/5' }],
        }))
        .mockReturnValueOnce(mockResponse({
          id: 5,
          ContentType: 'text/plain',
          Content: encoded,
        }));

      const result = await client.getTransaction(99) as { Attachments: Array<{ Content: string }> };
      expect(result.Attachments[0].Content).toBe('Hello world');
    });

    it('skips decoding for non-text attachments', async () => {
      const encoded = Buffer.from('binary data').toString('base64');
      mockFetch
        .mockReturnValueOnce(mockResponse({
          id: 99,
          Type: 'Create',
          _hyperlinks: [{ ref: 'attachment', id: 6, _url: 'http://example.com/attachment/6' }],
        }))
        .mockReturnValueOnce(mockResponse({
          id: 6,
          ContentType: 'image/png',
          Content: encoded,
        }));

      const result = await client.getTransaction(99) as { Attachments: Array<{ Content: string }> };
      expect(result.Attachments[0].Content).toBe(encoded);
    });
  });

  describe('getTicketHistory', () => {
    it('calls the history endpoint', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ items: [] }));
      await client.getTicketHistory(7);

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('/REST/2.0/ticket/7/history');
    });

    it('passes fields param in URL', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ items: [] }));
      await client.getTicketHistory(7, { fields: 'Type,Content' });

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('fields=');
    });
  });

  describe('ticketComment', () => {
    it('defaults ContentType to text/plain when not provided', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(['Comment added']));
      await client.ticketComment(7, { Content: 'Internal note' });

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.ContentType).toBe('text/plain');
    });

    it('defaults ContentType to text/plain when explicitly undefined', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(['Comment added']));
      await client.ticketComment(7, { Content: 'Internal note', ContentType: undefined });

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.ContentType).toBe('text/plain');
    });

    it('POSTs to the comment endpoint', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(['Comment added']));
      await client.ticketComment(7, { Content: 'Internal note' });

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/REST/2.0/ticket/7/comment');
      expect(options.method).toBe('POST');
    });
  });

  describe('ticketCorrespond', () => {
    it('defaults ContentType to text/plain when not provided', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(['Correspondence added']));
      await client.ticketCorrespond(7, { Content: 'Reply to requestor' });

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.ContentType).toBe('text/plain');
    });

    it('defaults ContentType to text/plain when explicitly undefined', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(['Correspondence added']));
      await client.ticketCorrespond(7, { Content: 'Reply to requestor', ContentType: undefined });

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.ContentType).toBe('text/plain');
    });

    it('POSTs to the correspond endpoint', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(['Correspondence added']));
      await client.ticketCorrespond(7, { Content: 'Reply to requestor' });

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/REST/2.0/ticket/7/correspond');
      expect(options.method).toBe('POST');
    });
  });

  describe('getCurrentUser', () => {
    it('extracts user ID from token and calls user endpoint', async () => {
      const clientWithToken = new RTClient('http://rt.example.com', '1-42-abc123');
      mockFetch.mockReturnValueOnce(mockResponse({ id: 42, Name: 'jsmith' }));
      await clientWithToken.getCurrentUser();

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('/REST/2.0/user/42');
    });

    it('throws if token format is invalid', async () => {
      const clientBadToken = new RTClient('http://rt.example.com', 'badtoken');
      await expect(clientBadToken.getCurrentUser()).rejects.toThrow('Could not determine user ID');
    });
  });

  describe('queue operations', () => {
    it('getQueue calls the correct endpoint', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ id: 1, Name: 'General' }));
      await client.getQueue('General');

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('/REST/2.0/queue/General');
    });

    it('listQueues calls the all endpoint', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ items: [] }));
      await client.listQueues();

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('/REST/2.0/queues/all');
    });
  });

  describe('lookupUser', () => {
    it('sends pagination params as URL query params, not in body', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ items: [] }));
      await client.lookupUser('alice', { per_page: 10, page: 2 });

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('per_page=10');
      expect(url).toContain('page=2');
      const body = JSON.parse(options.body as string);
      expect(body).not.toHaveProperty('per_page');
      expect(body).not.toHaveProperty('page');
    });

    it('POSTs to users with OR query for name and email', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ items: [] }));
      await client.lookupUser('alice');

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/REST/2.0/users');
      expect(options.method).toBe('POST');
      const body = JSON.parse(options.body as string);
      expect(Array.isArray(body)).toBe(true);
      expect(body).toContainEqual({ field: 'Name', operator: 'LIKE', value: 'alice' });
      expect(body).toContainEqual(
        expect.objectContaining({ field: 'EmailAddress', entry_aggregator: 'OR' }),
      );
    });
  });

  describe('getQueueFields', () => {
    it('fetches queue then fetches each custom field', async () => {
      mockFetch
        .mockReturnValueOnce(
          mockResponse({
            id: 1,
            Name: 'General',
            Lifecycle: 'default',
            TicketCustomFields: [{ id: 10 }, { id: 11 }],
          }),
        )
        .mockReturnValueOnce(mockResponse({ id: 10, Name: 'Category', Type: 'Select', Values: ['Bug', 'Feature'] }))
        .mockReturnValueOnce(mockResponse({ id: 11, Name: 'Severity', Type: 'Select', Values: ['Low', 'High'] }));

      const result = await client.getQueueFields('General') as {
        id: number;
        Name: string;
        Lifecycle: string;
        CustomFields: unknown[];
      };

      expect(result.id).toBe(1);
      expect(result.Name).toBe('General');
      expect(result.Lifecycle).toBe('default');
      expect(result.CustomFields).toHaveLength(2);
    });

    it('returns empty CustomFields when queue has none', async () => {
      mockFetch.mockReturnValueOnce(
        mockResponse({ id: 2, Name: 'Empty', Lifecycle: 'default' }),
      );

      const result = await client.getQueueFields('Empty') as { CustomFields: unknown[] };
      expect(result.CustomFields).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    it('throws with RT error message on failure', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ message: 'Ticket not found' }, 404));
      await expect(client.getTicket(999)).rejects.toThrow('Ticket not found');
    });

    it('throws with status text when no message in body', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({}, 500));
      await expect(client.getTicket(1)).rejects.toThrow('500');
    });
  });
});
