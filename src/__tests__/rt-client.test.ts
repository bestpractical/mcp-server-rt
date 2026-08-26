import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RTClient, UpdateTicketFields } from '../rt-client.js';

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

  // RT's collection endpoints return id-only stubs unless a fields parameter is
  // supplied, so these tools returned data the AI could not use.
  describe('collection defaults', () => {
    function params(callIndex = 0): URLSearchParams {
      const [url] = mockFetch.mock.calls[callIndex] as [string];
      return new URL(url).searchParams;
    }

    it('searchTickets requests a useful default field set', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ items: [] }));
      await client.searchTickets('id > 0');

      const fields = params().get('fields') ?? '';
      expect(fields).toContain('Subject');
      expect(fields).toContain('Status');
      expect(fields).toContain('Queue');
    });

    it('searchTickets expands Queue and Owner names by default', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ items: [] }));
      await client.searchTickets('id > 0');

      expect(params().get('fields[Queue]')).toBe('Name');
      expect(params().get('fields[Owner]')).toBe('Name');
    });

    // Both fields and subfields replace the default outright rather than
    // merging with it. fields has to — it is one RT parameter — and subfields
    // follows so the two behave the same way. The tool schemas say so.
    it('searchTickets lets the caller override the defaults', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ items: [] }));
      await client.searchTickets('id > 0', {
        fields: 'Subject',
        subfields: { Queue: 'Name,Description' },
      });

      expect(params().get('fields')).toBe('Subject');
      expect(params().get('fields[Queue]')).toBe('Name,Description');
      expect(params().has('fields[Owner]')).toBe(false);
    });

    it('getTicketHistory requests the transaction detail fields', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ items: [] }));
      await client.getTicketHistory(7);

      const fields = params().get('fields') ?? '';
      expect(fields).toContain('Type');
      expect(fields).toContain('NewValue');
      expect(fields).toContain('Created');
    });

    it('getTicketAttachments requests names, types and sizes', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ items: [] }));
      await client.getTicketAttachments(7);

      const fields = params().get('fields') ?? '';
      expect(fields).toContain('Filename');
      expect(fields).toContain('ContentType');
      expect(fields).toContain('ContentLength');
    });

    it('getTicketAttachments lets the caller override the default', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ items: [] }));
      await client.getTicketAttachments(7, { fields: 'Filename' });

      expect(params().get('fields')).toBe('Filename');
    });

    it('lookupUser requests names and email addresses', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ items: [] }));
      await client.lookupUser('root');

      const fields = params().get('fields') ?? '';
      expect(fields).toContain('Name');
      expect(fields).toContain('RealName');
      expect(fields).toContain('EmailAddress');
    });

    it('lookupUser lets the caller override the default', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ items: [] }));
      await client.lookupUser('root', { fields: 'Name' });

      expect(params().get('fields')).toBe('Name');
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

    // Description is HTML, rendered raw after scrubbing, so a newline does
    // nothing and multi-line text arrives as one run-on paragraph.
    describe('Description formatting', () => {
      it('turns plain multi-line text into paragraphs', async () => {
        mockFetch.mockReturnValueOnce(mockResponse({ id: 1 }));
        await client.createTicket({
          Queue: 'General',
          Subject: 'Test',
          Description: 'First line\nSecond line\n\nNew paragraph',
        });

        const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(JSON.parse(options.body as string).Description).toBe(
          '<p>First line<br />Second line</p><p>New paragraph</p>',
        );
      });

      it('leaves a value that already contains markup untouched', async () => {
        mockFetch.mockReturnValueOnce(mockResponse({ id: 1 }));
        await client.createTicket({
          Queue: 'General',
          Subject: 'Test',
          Description: '<p>Already</p>\n<p>formatted</p>',
        });

        const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(JSON.parse(options.body as string).Description).toBe(
          '<p>Already</p>\n<p>formatted</p>',
        );
      });

      it('leaves single-line text untouched', async () => {
        mockFetch.mockReturnValueOnce(mockResponse({ id: 1 }));
        await client.createTicket({ Queue: 'General', Subject: 'Test', Description: 'One line' });

        const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(JSON.parse(options.body as string).Description).toBe('One line');
      });

      // A comparison is not markup. Treating any "<" as markup skipped
      // conversion, so the newline rendered as nothing.
      it('escapes a bare "<" rather than treating it as markup', async () => {
        mockFetch.mockReturnValueOnce(mockResponse({ id: 1 }));
        await client.createTicket({
          Queue: 'General',
          Subject: 'Test',
          Description: 'Disk usage < 10% free\nPlease investigate',
        });

        const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(JSON.parse(options.body as string).Description).toBe(
          '<p>Disk usage &lt; 10% free<br />Please investigate</p>',
        );
      });

      // RT deletes a tag it does not allow along with the text inside it, so
      // an unescaped <bob@example.com> loses the address with no error.
      it('escapes angle brackets that RT would strip as an unknown tag', async () => {
        mockFetch.mockReturnValueOnce(mockResponse({ id: 1 }));
        await client.createTicket({
          Queue: 'General',
          Subject: 'Test',
          Description: 'Contact <bob@example.com>\nRetry tomorrow',
        });

        const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(JSON.parse(options.body as string).Description).toBe(
          '<p>Contact &lt;bob@example.com&gt;<br />Retry tomorrow</p>',
        );
      });

      // RT escapes a bare "&" itself and does not double-escape an entity, so
      // leaving "&" alone keeps a deliberate "&amp;" intact.
      it('leaves ampersands for RT to handle', async () => {
        mockFetch.mockReturnValueOnce(mockResponse({ id: 1 }));
        await client.createTicket({
          Queue: 'General',
          Subject: 'Test',
          Description: 'AT&T\n&amp; more',
        });

        const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(JSON.parse(options.body as string).Description).toBe(
          '<p>AT&T<br />&amp; more</p>',
        );
      });

      // Wrapping a blank value in <p></p> writes a non-empty field and logs a
      // spurious "Description changed" transaction.
      it('leaves a whitespace-only value untouched', async () => {
        mockFetch.mockReturnValueOnce(mockResponse(['Description changed']));
        await client.updateTicket(7, { Description: '  \n  ' });

        const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(JSON.parse(options.body as string).Description).toBe('  \n  ');
      });

      it('applies the same handling on update', async () => {
        mockFetch.mockReturnValueOnce(mockResponse(['Description changed']));
        await client.updateTicket(7, { Description: 'One\nTwo' });

        const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(JSON.parse(options.body as string).Description).toBe('<p>One<br />Two</p>');
      });
    });

    it('leaves non-date fields unchanged', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ id: 1 }));
      await client.createTicket({ Queue: 'General', Subject: 'Test', Owner: 'alice' });

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.Owner).toBe('alice');
    });

    // RT::Ticket::Create stores Priority straight into an int column and never
    // resolves a PriorityAsString label, so a label has to be applied afterwards
    // through SetPriority, which does resolve it.
    describe('priority labels', () => {
      it('sends a numeric priority in the create body', async () => {
        mockFetch.mockReturnValueOnce(mockResponse({ id: 1 }));
        await client.createTicket({ Queue: 'General', Subject: 'Test', Priority: 80 });

        expect(mockFetch.mock.calls).toHaveLength(1);
        const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(JSON.parse(options.body as string).Priority).toBe(80);
      });

      it('treats a numeric string as a number and sends it in the create body', async () => {
        mockFetch.mockReturnValueOnce(mockResponse({ id: 1 }));
        await client.createTicket({ Queue: 'General', Subject: 'Test', Priority: '80' });

        expect(mockFetch.mock.calls).toHaveLength(1);
        const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(JSON.parse(options.body as string).Priority).toBe('80');
      });

      // RT's SetPriority only takes /^\d+$/ as a number and looks everything
      // else up as a label. A value this classified as a number but RT does not
      // would be stored verbatim on create and coerced to 0 on update, so the
      // two have to agree on where the line falls.
      it.each(['-5', ' 80 ', '8.0', ''])(
        'defers %j to the follow-up update, as RT would not read it as a number',
        async (priority) => {
          mockFetch
            .mockReturnValueOnce(mockResponse({ id: '7', type: 'ticket' }))
            .mockReturnValueOnce(mockResponse(['Ticket 7: Priority changed']));

          await client.createTicket({ Queue: 'General', Subject: 'Test', Priority: priority });

          expect(mockFetch.mock.calls).toHaveLength(2);
          const [, createOpts] = mockFetch.mock.calls[0] as [string, RequestInit];
          expect('Priority' in JSON.parse(createOpts.body as string)).toBe(false);

          const [, updateOpts] = mockFetch.mock.calls[1] as [string, RequestInit];
          expect(JSON.parse(updateOpts.body as string).Priority).toBe(priority);
        },
      );

      it('omits a label from the create body and sets it in a follow-up update', async () => {
        mockFetch
          .mockReturnValueOnce(mockResponse({ id: '7', type: 'ticket' }))
          .mockReturnValueOnce(mockResponse(["Ticket 7: Priority changed from 'Low' to 'High'"]));

        await client.createTicket({ Queue: 'General', Subject: 'Test', Priority: 'High' });

        expect(mockFetch.mock.calls).toHaveLength(2);

        const [createUrl, createOpts] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(createUrl).toContain('/REST/2.0/ticket');
        expect('Priority' in JSON.parse(createOpts.body as string)).toBe(false);

        const [updateUrl, updateOpts] = mockFetch.mock.calls[1] as [string, RequestInit];
        expect(updateUrl).toContain('/REST/2.0/ticket/7');
        expect(updateOpts.method).toBe('PUT');
        expect(JSON.parse(updateOpts.body as string).Priority).toBe('High');
      });

      it('still returns the new ticket id when the follow-up priority update fails', async () => {
        mockFetch
          .mockReturnValueOnce(mockResponse({ id: '7', type: 'ticket' }))
          .mockReturnValueOnce(mockResponse({ message: 'Invalid priority' }, 400));

        const result = await client.createTicket({
          Queue: 'General',
          Subject: 'Test',
          Priority: 'Catastrophic',
        }) as Record<string, unknown>;

        expect(result.id).toBe('7');
        expect(result.PriorityNotSet).toContain('Invalid priority');
      });

      // Number('') is 0, which would send the follow-up to ticket/0 and set the
      // priority on whatever that resolves to rather than on the new ticket.
      it.each([{ id: '' }, { id: 'abc' }, {}])(
        'does not attempt the follow-up when the create returns %j as the id',
        async (created) => {
          mockFetch.mockReturnValueOnce(mockResponse(created));

          const result = await client.createTicket({
            Queue: 'General',
            Subject: 'Test',
            Priority: 'High',
          }) as Record<string, unknown>;

          expect(mockFetch.mock.calls).toHaveLength(1);
          expect(result.PriorityNotSet).toBe('Could not determine the new ticket ID');
        },
      );

      // RT reports the change naming the label it resolved to, which is the
      // only evidence the caller gets that the label was understood.
      it('reports back the priority change RT made', async () => {
        mockFetch
          .mockReturnValueOnce(mockResponse({ id: '7', type: 'ticket' }))
          .mockReturnValueOnce(mockResponse(["Ticket 7: Priority changed from 'Low' to 'High'"]));

        const result = await client.createTicket({
          Queue: 'General',
          Subject: 'Test',
          Priority: 'High',
        }) as Record<string, unknown>;

        expect(result.id).toBe('7');
        expect(result.PrioritySet).toEqual(["Ticket 7: Priority changed from 'Low' to 'High'"]);
      });

      // An unrecognized label is not an error to RT: SetPriority falls back to
      // 0 and reports success, so the change it names is the caller's only way
      // to notice that the label did not land.
      it('surfaces the coerced label when RT does not recognize the one sent', async () => {
        mockFetch
          .mockReturnValueOnce(mockResponse({ id: '7', type: 'ticket' }))
          .mockReturnValueOnce(mockResponse(["Ticket 7: Priority changed from 'High' to 'Low'"]));

        const result = await client.createTicket({
          Queue: 'General',
          Subject: 'Test',
          Priority: 'Catastrophic',
        }) as Record<string, unknown>;

        expect(result.PriorityNotSet).toBeUndefined();
        expect(result.PrioritySet).toEqual(["Ticket 7: Priority changed from 'High' to 'Low'"]);
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

    it('converts date fields from local time to UTC', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(['Due date changed']));
      await client.updateTicket(7, { Due: '2026-03-09 00:00:00' });

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      // Tests run with TZ=UTC, so local time == UTC; exact value should be preserved
      expect(body.Due).toBe('2026-03-09 00:00:00');
    });

    // RT resolves the label itself here, per queue, via SetPriority.
    it('passes a priority label straight through', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(["Priority changed from 'Low' to 'High'"]));
      await client.updateTicket(7, { Priority: 'High' });

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(options.body as string).Priority).toBe('High');
    });

    // A bare link relation is refused because RT would read it as the complete
    // list for that relation. The refusal has to arrive as a rejected promise:
    // a caller that handles failures with .catch() and never wraps the call in
    // try/catch would otherwise take an uncaught exception.
    it('rejects a bare link relation without calling RT', async () => {
      const result = client.updateTicket(7, { RefersTo: 9 } as UpdateTicketFields);

      expect(result).toBeInstanceOf(Promise);
      await expect(result).rejects.toThrow(/AddRefersTo/);
      expect(mockFetch).not.toHaveBeenCalled();
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

    it('sends CustomFields in the request body', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(['Comment added']));
      await client.ticketComment(7, {
        Content: 'Internal note',
        CustomFields: { Category: 'Billing', 'Ticket Cost': 42 },
      });

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.CustomFields).toEqual({ Category: 'Billing', 'Ticket Cost': 42 });
    });

    it('omits CustomFields from the body when not provided', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(['Comment added']));
      await client.ticketComment(7, { Content: 'Internal note' });

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect('CustomFields' in body).toBe(false);
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

    it('sends CustomFields in the request body', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(['Correspondence added']));
      await client.ticketCorrespond(7, {
        Content: 'Reply to requestor',
        CustomFields: { Category: 'Billing' },
      });

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.CustomFields).toEqual({ Category: 'Billing' });
    });

    it('omits CustomFields from the body when not provided', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(['Correspondence added']));
      await client.ticketCorrespond(7, { Content: 'Reply to requestor' });

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect('CustomFields' in body).toBe(false);
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

    // The CF type decides how RT renders a value, but "Text" vs
    // "HTML" vs "Freeform" says nothing to an AI about what to send.
    describe('content format hints', () => {
      const cases: Array<[string, string]> = [
        ['HTML', 'html'],
        ['Text', 'plain-text-multiline'],
        ['Wikitext', 'wikitext'],
        ['Freeform', 'plain-text'],
        ['Select', 'plain-text'],
      ];

      it.each(cases)('labels a %s field as %s', async (type, expected) => {
        mockFetch
          .mockReturnValueOnce(
            mockResponse({
              id: 1,
              Name: 'General',
              Lifecycle: 'default',
              TicketCustomFields: [{ id: 10, name: 'Field' }],
            }),
          )
          .mockReturnValueOnce(mockResponse({ id: 10, Name: 'Field', Type: type }));

        const result = await client.getQueueFields('General') as {
          CustomFields: Array<Record<string, unknown>>;
        };
        expect(result.CustomFields[0].ContentFormat).toBe(expected);
      });

      it('labels the queue and transaction groups too', async () => {
        mockFetch
          .mockReturnValueOnce(
            mockResponse({
              id: 1,
              Name: 'General',
              Lifecycle: 'default',
              CustomFields: [{ id: 2, name: 'Q', values: [] }],
              TicketTransactionCustomFields: [{ id: 3, name: 'T' }],
            }),
          )
          .mockReturnValueOnce(mockResponse({ id: 2, Name: 'Q', Type: 'HTML' }))
          .mockReturnValueOnce(mockResponse({ id: 3, Name: 'T', Type: 'Text' }));

        const result = await client.getQueueFields('General') as {
          QueueCustomFields: Array<Record<string, unknown>>;
          TransactionCustomFields: Array<Record<string, unknown>>;
        };
        expect(result.QueueCustomFields[0].ContentFormat).toBe('html');
        expect(result.TransactionCustomFields[0].ContentFormat).toBe('plain-text-multiline');
      });

      it('adds no hint to a field whose details could not be read', async () => {
        mockFetch
          .mockReturnValueOnce(
            mockResponse({
              id: 1,
              Name: 'General',
              Lifecycle: 'default',
              TicketCustomFields: [{ id: 10, name: 'Hidden' }],
            }),
          )
          .mockReturnValueOnce(mockResponse({ message: 'Forbidden' }, 403));

        const result = await client.getQueueFields('General') as {
          CustomFields: Array<Record<string, unknown>>;
        };
        expect(result.CustomFields[0]).not.toHaveProperty('ContentFormat');
      });
    });

    it('returns empty CustomFields when queue has none', async () => {
      mockFetch.mockReturnValueOnce(
        mockResponse({ id: 2, Name: 'Empty', Lifecycle: 'default' }),
      );

      const result = await client.getQueueFields('Empty') as { CustomFields: unknown[] };
      expect(result.CustomFields).toHaveLength(0);
    });

    it('keeps a custom field whose detail fetch is forbidden', async () => {
      mockFetch
        .mockReturnValueOnce(
          mockResponse({
            id: 1,
            Name: 'General',
            Lifecycle: 'default',
            TicketCustomFields: [
              { id: 10, name: 'Category', ref: 'customfield' },
              { id: 11, name: 'Severity', ref: 'customfield' },
            ],
          }),
        )
        .mockReturnValueOnce(mockResponse({ id: 10, Name: 'Category', Type: 'Select', Values: ['Bug'] }))
        .mockReturnValueOnce(mockResponse({ message: 'Forbidden' }, 403));

      const result = await client.getQueueFields('General') as {
        CustomFields: Array<Record<string, unknown>>;
      };

      expect(result.CustomFields).toHaveLength(2);
      expect(result.CustomFields[0]).toMatchObject({ Name: 'Category', Type: 'Select' });
      expect(result.CustomFields[1]).toMatchObject({ id: 11, Name: 'Severity' });
      expect(result.CustomFields[1].DetailsUnavailable).toContain('403');
    });

    // RT keeps three separate groups of custom fields on a queue record.
    // RTIR puts "RTIR Constituency" and "RTIR default WHOIS server" in the
    // queue's own CustomFields, so reading only TicketCustomFields reported
    // them as missing.
    it('reports the queue\'s own and transaction custom fields separately', async () => {
      mockFetch
        .mockReturnValueOnce(
          mockResponse({
            id: 1,
            Name: 'Incidents',
            Lifecycle: 'incidents',
            TicketCustomFields: [{ id: 4, name: 'Classification' }],
            CustomFields: [{ id: 2, name: 'RTIR default WHOIS server', values: ['whois.example.com'] }],
            TicketTransactionCustomFields: [{ id: 9, name: 'Txn Note' }],
          }),
        )
        // Ticket CFs are fetched first, then queue CFs, then transaction CFs.
        .mockReturnValueOnce(mockResponse({ id: 4, Name: 'Classification', Type: 'Select' }))
        .mockReturnValueOnce(mockResponse({ id: 2, Name: 'RTIR default WHOIS server', Type: 'Freeform' }))
        .mockReturnValueOnce(mockResponse({ id: 9, Name: 'Txn Note', Type: 'Freeform' }));

      const result = await client.getQueueFields('Incidents') as {
        CustomFields: Array<Record<string, unknown>>;
        QueueCustomFields: Array<Record<string, unknown>>;
        TransactionCustomFields: Array<Record<string, unknown>>;
      };

      expect(result.CustomFields.map((cf) => cf.Name)).toEqual(['Classification']);
      expect(result.QueueCustomFields.map((cf) => cf.Name)).toEqual(['RTIR default WHOIS server']);
      expect(result.TransactionCustomFields.map((cf) => cf.Name)).toEqual(['Txn Note']);
    });

    it('includes the current values of the queue\'s own custom fields', async () => {
      mockFetch
        .mockReturnValueOnce(
          mockResponse({
            id: 1,
            Name: 'Incidents',
            Lifecycle: 'incidents',
            CustomFields: [{ id: 2, name: 'RTIR default WHOIS server', values: ['whois.example.com'] }],
          }),
        )
        .mockReturnValueOnce(mockResponse({ id: 2, Name: 'RTIR default WHOIS server', Type: 'Freeform' }));

      const result = await client.getQueueFields('Incidents') as {
        QueueCustomFields: Array<Record<string, unknown>>;
      };

      expect(result.QueueCustomFields[0].CurrentValues).toEqual(['whois.example.com']);
    });

    it('keeps a queue custom field whose detail fetch is forbidden', async () => {
      mockFetch
        .mockReturnValueOnce(
          mockResponse({
            id: 1,
            Name: 'Incidents',
            Lifecycle: 'incidents',
            CustomFields: [{ id: 2, name: 'RTIR Constituency', values: ['Government'] }],
          }),
        )
        .mockReturnValueOnce(mockResponse({ message: 'Forbidden' }, 403));

      const result = await client.getQueueFields('Incidents') as {
        QueueCustomFields: Array<Record<string, unknown>>;
      };

      expect(result.QueueCustomFields).toHaveLength(1);
      expect(result.QueueCustomFields[0]).toMatchObject({ id: 2, Name: 'RTIR Constituency' });
      expect(result.QueueCustomFields[0].DetailsUnavailable).toContain('403');
      // The queue record already told us the value, so it survives the failed fetch.
      expect(result.QueueCustomFields[0].CurrentValues).toEqual(['Government']);
    });

    it('returns empty groups when the queue has no queue or transaction fields', async () => {
      mockFetch.mockReturnValueOnce(
        mockResponse({ id: 2, Name: 'Empty', Lifecycle: 'default' }),
      );

      const result = await client.getQueueFields('Empty') as {
        QueueCustomFields: unknown[];
        TransactionCustomFields: unknown[];
      };

      expect(result.QueueCustomFields).toEqual([]);
      expect(result.TransactionCustomFields).toEqual([]);
    });

    // When SeeCustomField is granted at queue level rather than globally,
    // RT lists the CFs on the queue record (which sets the queue as ACL
    // context) but forbids GET /customfield/{id} (which has no context).
    // Every field was silently dropped, so the queue looked like it had none.
    it('reports every custom field the queue lists even when all detail fetches fail', async () => {
      mockFetch
        .mockReturnValueOnce(
          mockResponse({
            id: 1,
            Name: 'General',
            Lifecycle: 'default',
            TicketCustomFields: [
              { id: 10, name: 'Category' },
              { id: 11, name: 'Severity' },
              { id: 12, name: 'Where Blocked' },
            ],
          }),
        )
        .mockReturnValue(mockResponse({ message: 'Forbidden' }, 403));

      const result = await client.getQueueFields('General') as {
        CustomFields: Array<Record<string, unknown>>;
      };

      expect(result.CustomFields).toHaveLength(3);
      expect(result.CustomFields.map((cf) => cf.Name)).toEqual([
        'Category',
        'Severity',
        'Where Blocked',
      ]);
    });
  });

  describe('URL rewriting', () => {
    it('rewrites a ticket URL to the web UI but not one below the ticket', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({
        id: 42,
        _hyperlinks: [
          { ref: 'self', _url: 'http://rt.example.com/REST/2.0/ticket/42' },
          { ref: 'history', _url: 'http://rt.example.com/REST/2.0/ticket/42/history' },
        ],
      }));

      const result = await client.getTicket(42) as { _hyperlinks: Array<{ _url: string }> };
      expect(result._hyperlinks[0]._url).toBe('http://rt.example.com/Ticket/Display.html?id=42');
      expect(result._hyperlinks[1]._url).toBe('http://rt.example.com/REST/2.0/ticket/42/history');
    });

    // The match took the first path segment after /ticket/ as the ID and
    // rewrote the whole string, so every URL below a ticket became that
    // ticket's display page — including the next_page link of a sub-collection.
    it('does not rewrite the next_page link of a ticket sub-collection', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({
        items: [],
        next_page: 'http://rt.example.com/REST/2.0/ticket/12/attachments?per_page=3&page=2',
      }));

      const result = await client.getTicketAttachments(12) as { next_page: string };
      expect(result.next_page).toBe(
        'http://rt.example.com/REST/2.0/ticket/12/attachments?per_page=3&page=2',
      );
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
