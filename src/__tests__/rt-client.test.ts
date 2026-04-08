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

    it('converts date fields from local time to UTC', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ id: 1 }));
      await client.createTicket({ Queue: 'General', Subject: 'Test', Due: '2026-03-09 00:00:00' });

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      // Tests run with TZ=UTC, so local time == UTC; exact value should be preserved
      expect(body.Due).toBe('2026-03-09 00:00:00');
    });

    it('leaves non-date fields unchanged', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ id: 1 }));
      await client.createTicket({ Queue: 'General', Subject: 'Test', Owner: 'alice' });

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.Owner).toBe('alice');
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

    it('converts date fields from local time to UTC', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(['Due date changed']));
      await client.updateTicket(7, { Due: '2026-03-09 00:00:00' });

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      // Tests run with TZ=UTC, so local time == UTC; exact value should be preserved
      expect(body.Due).toBe('2026-03-09 00:00:00');
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

  describe('URL rewriting', () => {
    it('rewrites REST ticket URLs to web UI URLs in responses', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({
        id: 42,
        _hyperlinks: [
          { ref: 'self', _url: 'http://rt.example.com/REST/2.0/ticket/42' },
          { ref: 'history', _url: 'http://rt.example.com/REST/2.0/ticket/42/history' },
        ],
      }));

      const result = await client.getTicket(42) as { _hyperlinks: Array<{ _url: string }> };
      expect(result._hyperlinks[0]._url).toBe('http://rt.example.com/Ticket/Display.html?id=42');
    });

    it('does not rewrite non-ticket REST URLs', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({
        id: 42,
        _hyperlinks: [
          { ref: 'attachment', _url: 'http://rt.example.com/REST/2.0/attachment/5' },
          { ref: 'queue', _url: 'http://rt.example.com/REST/2.0/queue/1' },
        ],
      }));

      const result = await client.getTicket(42) as { _hyperlinks: Array<{ _url: string }> };
      expect(result._hyperlinks[0]._url).toBe('http://rt.example.com/REST/2.0/attachment/5');
      expect(result._hyperlinks[1]._url).toBe('http://rt.example.com/REST/2.0/queue/1');
    });

    it('rewrites ticket URLs nested inside search results', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({
        count: 1,
        items: [
          { id: 7, _url: 'http://rt.example.com/REST/2.0/ticket/7', Subject: 'Test' },
        ],
      }));

      const result = await client.searchTickets('id = 7') as {
        items: Array<{ _url: string }>;
      };
      expect(result.items[0]._url).toBe('http://rt.example.com/Ticket/Display.html?id=7');
    });

    it('does not rewrite URLs from a different host', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({
        id: 42,
        _hyperlinks: [{ ref: 'self', _url: 'http://other.example.com/REST/2.0/ticket/42' }],
      }));

      const result = await client.getTicket(42) as { _hyperlinks: Array<{ _url: string }> };
      expect(result._hyperlinks[0]._url).toBe('http://other.example.com/REST/2.0/ticket/42');
    });

    it('preserves attachment ID extraction in getTransaction after rewriting', async () => {
      const encoded = Buffer.from('Hello').toString('base64');
      mockFetch
        .mockReturnValueOnce(mockResponse({
          id: 99,
          Type: 'Correspond',
          _hyperlinks: [
            { ref: 'attachment', id: 5, _url: 'http://rt.example.com/REST/2.0/attachment/5' },
          ],
        }))
        .mockReturnValueOnce(mockResponse({
          id: 5,
          ContentType: 'text/plain',
          Content: encoded,
        }));

      const result = await client.getTransaction(99) as { Attachments: Array<{ Content: string }> };
      expect(result.Attachments).toHaveLength(1);
      expect(result.Attachments[0].Content).toBe('Hello');
    });
  });

  describe('createQueue', () => {
    it('POSTs to the queue endpoint', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ id: 10, _url: 'http://rt.example.com/REST/2.0/queue/10' }));
      await client.createQueue({ Name: 'Support', Description: 'Support queue' });

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/REST/2.0/queue');
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body as string)).toMatchObject({ Name: 'Support' });
    });
  });

  describe('updateQueue', () => {
    it('PUTs to the queue endpoint', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(['Queue updated']));
      await client.updateQueue('Support', { Description: 'Updated' });

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/REST/2.0/queue/Support');
      expect(options.method).toBe('PUT');
      expect(JSON.parse(options.body as string)).toMatchObject({ Description: 'Updated' });
    });
  });

  describe('listLifecycles', () => {
    it('GETs the lifecycles endpoint', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ items: [] }));
      await client.listLifecycles();

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('/REST/2.0/lifecycles');
      expect(url).not.toContain('type=');
    });

    it('passes type filter as query param', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ items: [] }));
      await client.listLifecycles('ticket');

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('type=ticket');
    });
  });

  describe('getLifecycle', () => {
    it('GETs the lifecycle by name', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ name: 'default', statuses: [] }));
      await client.getLifecycle('default');

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('/REST/2.0/lifecycle/default');
    });
  });

  describe('getAvailableRights', () => {
    it('builds the correct path for a queue', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ rights: [] }));
      await client.getAvailableRights('queue', '5');

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('/REST/2.0/queue/5/rights/available');
    });

    it('builds the correct path for global', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ rights: [] }));
      await client.getAvailableRights('global');

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('/REST/2.0/global/rights/available');
    });
  });

  describe('listRights', () => {
    it('GETs the rights endpoint for a queue', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ items: [] }));
      await client.listRights('queue', '3');

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('/REST/2.0/queue/3/rights');
    });

    it('passes user and group filters', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ items: [] }));
      await client.listRights('queue', '3', { user: '42' });

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('user=42');
    });
  });

  describe('grantRight', () => {
    it('POSTs to the rights endpoint', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ id: 1 }));
      await client.grantRight('queue', '5', { Right: 'CreateTicket', User: 'alice' });

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/REST/2.0/queue/5/rights');
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body as string)).toMatchObject({ Right: 'CreateTicket', User: 'alice' });
    });

    it('POSTs to global rights endpoint when type is global', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ id: 1 }));
      await client.grantRight('global', undefined, { Right: 'CreateTicket', Group: 'Everyone' });

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('/REST/2.0/global/rights');
    });
  });

  describe('revokeRight', () => {
    it('DELETEs the correct rights path for a user', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({}));
      await client.revokeRight('queue', '5', 'CreateTicket', 'user', '42');

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/REST/2.0/queue/5/rights/CreateTicket/user/42');
      expect(options.method).toBe('DELETE');
    });

    it('DELETEs the correct rights path for a group', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({}));
      await client.revokeRight('queue', '5', 'SeeQueue', 'group', '10');

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('/REST/2.0/queue/5/rights/SeeQueue/group/10');
    });
  });

  describe('bulkRights', () => {
    it('POSTs to the bulk rights endpoint', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({}));
      const grants = [{ Right: 'CreateTicket', User: 'alice' }, { Right: 'SeeQueue', User: 'alice' }];
      await client.bulkRights('queue', '5', { grant: grants });

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/REST/2.0/queue/5/rights/bulk');
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body as string)).toMatchObject({ grant: grants });
    });
  });

  describe('createCustomField', () => {
    it('POSTs to the customfield endpoint', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ id: 7 }));
      await client.createCustomField({ Name: 'Priority', Type: 'SelectSingle', LookupType: 'RT::Queue-RT::Ticket' });

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/REST/2.0/customfield');
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body as string)).toMatchObject({ Name: 'Priority' });
    });
  });

  describe('addCustomFieldValue', () => {
    it('POSTs to the customfield value endpoint', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ id: 1 }));
      await client.addCustomFieldValue(7, { Name: 'High' });

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/REST/2.0/customfield/7/value');
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body as string)).toMatchObject({ Name: 'High' });
    });
  });

  describe('applyCustomField', () => {
    it('POSTs to the appliesto endpoint with ObjectId', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({}));
      await client.applyCustomField(7, 3);

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/REST/2.0/customfield/7/appliesto');
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body as string)).toMatchObject({ ObjectId: 3 });
    });
  });

  describe('removeCustomFieldApplication', () => {
    it('DELETEs the appliesto object endpoint', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({}));
      await client.removeCustomFieldApplication(7, 3);

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/REST/2.0/customfield/7/appliesto/object/3');
      expect(options.method).toBe('DELETE');
    });
  });

  describe('listCustomFieldApplications', () => {
    it('GETs the appliesto endpoint', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ items: [] }));
      await client.listCustomFieldApplications(7);

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('/REST/2.0/customfield/7/appliesto');
    });

    it('passes pagination params', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ items: [] }));
      await client.listCustomFieldApplications(7, { per_page: 10, page: 2 });

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('per_page=10');
      expect(url).toContain('page=2');
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
