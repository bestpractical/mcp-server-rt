import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { RTClient, CONTENT_FORMATS } from '../rt-client.js';
import { TOOLS, callTool } from '../tools.js';

// Mock global fetch so we can assert on the request the tool layer produces.
// Using a real RTClient (rather than a stub) means these tests cover the whole
// path from tool arguments through to the RT REST request body.
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

function tool(name: string): Tool {
  const found = TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`No such tool: ${name}`);
  return found;
}

function schemaProperties(name: string): Record<string, unknown> {
  return (tool(name).inputSchema.properties ?? {}) as Record<string, unknown>;
}

function requestBody(callIndex = 0): Record<string, unknown> {
  const [, options] = mockFetch.mock.calls[callIndex] as [string, RequestInit];
  return JSON.parse(options.body as string);
}

function requestParams(callIndex = 0): URLSearchParams {
  const [url] = mockFetch.mock.calls[callIndex] as [string];
  return new URL(url).searchParams;
}

describe('tool layer', () => {
  let rt: RTClient;

  beforeEach(() => {
    rt = new RTClient('http://rt.example.com', 'test-token');
    mockFetch.mockReset();
  });

  describe('add_comment', () => {
    it('forwards the message fields to the comment endpoint', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(['Comment added']));
      await callTool(rt, 'add_comment', {
        id: 7,
        Content: '<p>Note</p>',
        ContentType: 'text/html',
        TimeTaken: 15,
      });

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('/REST/2.0/ticket/7/comment');
      expect(requestBody()).toMatchObject({
        Content: '<p>Note</p>',
        ContentType: 'text/html',
        TimeTaken: 15,
      });
    });

    it('declares CustomFields in its input schema', () => {
      expect(schemaProperties('add_comment')).toHaveProperty('CustomFields');
    });

    it('forwards CustomFields to the comment endpoint', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(['Comment added']));
      await callTool(rt, 'add_comment', {
        id: 7,
        Content: 'Internal note',
        CustomFields: { Category: 'Billing' },
      });

      expect(requestBody().CustomFields).toEqual({ Category: 'Billing' });
    });

    it('sends no CustomFields key when the caller omits it', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(['Comment added']));
      await callTool(rt, 'add_comment', { id: 7, Content: 'Internal note' });

      expect('CustomFields' in requestBody()).toBe(false);
    });

    // Some clients fill unused optional parameters with an explicit null, which
    // JSON.stringify keeps. Treat that the same as omitting the field.
    it('sends no CustomFields key when the caller passes null', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(['Comment added']));
      await callTool(rt, 'add_comment', { id: 7, Content: 'Internal note', CustomFields: null });

      expect('CustomFields' in requestBody()).toBe(false);
    });
  });

  describe('add_reply', () => {
    it('forwards the message fields to the correspond endpoint', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(['Correspondence added']));
      await callTool(rt, 'add_reply', {
        id: 7,
        Content: 'Reply to requestor',
        TimeTaken: 15,
        Status: 'resolved',
      });

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('/REST/2.0/ticket/7/correspond');
      expect(requestBody()).toMatchObject({
        Content: 'Reply to requestor',
        TimeTaken: 15,
        Status: 'resolved',
      });
    });

    it('declares CustomFields in its input schema', () => {
      expect(schemaProperties('add_reply')).toHaveProperty('CustomFields');
    });

    it('forwards CustomFields to the correspond endpoint', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(['Correspondence added']));
      await callTool(rt, 'add_reply', {
        id: 7,
        Content: 'Reply to requestor',
        CustomFields: { Category: 'Billing' },
      });

      expect(requestBody().CustomFields).toEqual({ Category: 'Billing' });
    });

    it('sends no CustomFields key when the caller omits it', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(['Correspondence added']));
      await callTool(rt, 'add_reply', { id: 7, Content: 'Reply to requestor' });

      expect('CustomFields' in requestBody()).toBe(false);
    });

    it('sends no CustomFields key when the caller passes null', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(['Correspondence added']));
      await callTool(rt, 'add_reply', { id: 7, Content: 'Reply to requestor', CustomFields: null });

      expect('CustomFields' in requestBody()).toBe(false);
    });
  });

  // Collection tools send a default field set, so the tool layer has to pass a
  // caller's fields through to override it and leave the default alone when the
  // caller says nothing.
  describe('collection fields', () => {
    const collectionTools = [
      { name: 'get_ticket_attachments', args: { id: 7 }, defaultField: 'ContentLength' },
      { name: 'lookup_user', args: { query: 'root' }, defaultField: 'EmailAddress' },
    ];

    it.each(collectionTools)('$name declares fields in its input schema', ({ name }) => {
      expect(schemaProperties(name)).toHaveProperty('fields');
    });

    it.each(collectionTools)('$name forwards fields to RT', async ({ name, args }) => {
      mockFetch.mockReturnValueOnce(mockResponse({ items: [] }));
      await callTool(rt, name, { ...args, fields: 'Subject' });

      expect(requestParams().get('fields')).toBe('Subject');
    });

    it.each(collectionTools)(
      '$name still sends the default when fields is omitted',
      async ({ name, args, defaultField }) => {
        mockFetch.mockReturnValueOnce(mockResponse({ items: [] }));
        await callTool(rt, name, args);

        expect(requestParams().get('fields')).toContain(defaultField);
      },
    );
  });

  // The schema descriptions are the only content guidance an AI sees when it is
  // writing a field, so they have to agree with what RT actually does.
  describe('content formatting guidance', () => {
    function fieldDescription(toolName: string, field: string): string {
      const property = schemaProperties(toolName)[field] as { description?: string };
      return property.description ?? '';
    }

    // These used to promise "you do not need to escape < , & or > — RT does
    // that". RT escapes a bare one, but deletes a tag it does not allow along
    // with the text inside it.
    it.each(['create_ticket', 'update_ticket'])(
      '%s tells the AI to escape angle brackets that are not markup',
      (toolName) => {
        const description = fieldDescription(toolName, 'Description');
        expect(description).toContain('&lt;');
        expect(description).not.toMatch(/(do not|don't) need to escape/i);
      },
    );

    it('get_queue_fields describes every content format the server can report', () => {
      const description = tool('get_queue_fields').description ?? '';
      for (const format of new Set([...Object.values(CONTENT_FORMATS), 'plain-text'])) {
        expect(description).toContain(`"${format}"`);
      }
    });
  });

  // Priority was integer-only, so the AI could not use the labels RT displays.
  // RT resolves labels per queue, so both tools accept either form.
  describe('priority', () => {
    it.each(['create_ticket', 'update_ticket'])('accepts a string or integer on %s', (name) => {
      const priority = schemaProperties(name).Priority as { type: unknown };
      expect(priority.type).toEqual(['integer', 'string']);
    });

    it('forwards a priority label on update_ticket', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(["Priority changed from 'Low' to 'High'"]));
      await callTool(rt, 'update_ticket', { id: 7, Priority: 'High' });

      expect(requestBody().Priority).toBe('High');
    });

    // RT answers an unrecognized label with priority 0 and a success report,
    // and the server cannot detect it, so each description has to warn that
    // sending a label is not the same as setting one.
    it.each(['create_ticket', 'update_ticket'])(
      'warns on %s that an unrecognized label becomes the lowest priority',
      (name) => {
        const { description } = schemaProperties(name).Priority as { description: string };

        expect(description).toMatch(/does not reject a label/i);
        expect(description).toMatch(/\b0\b.*lowest|lowest.*\b0\b/i);
        expect(description).toMatch(/reports success/i);
      },
    );

    it('tells the AI where to read the priority RT actually applied', () => {
      const create = (schemaProperties('create_ticket').Priority as { description: string })
        .description;
      const update = (schemaProperties('update_ticket').Priority as { description: string })
        .description;

      expect(create).toContain('PrioritySet');
      expect(update).toMatch(/Priority changed from/);
    });
  });

  describe('unknown tools', () => {
    it('throws for a tool name that does not exist', async () => {
      await expect(callTool(rt, 'no_such_tool', {})).rejects.toThrow('Unknown tool: no_such_tool');
    });
  });
});
