import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { RTClient } from '../rt-client.js';
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

  describe('unknown tools', () => {
    it('throws for a tool name that does not exist', async () => {
      await expect(callTool(rt, 'no_such_tool', {})).rejects.toThrow('Unknown tool: no_such_tool');
    });
  });
});
