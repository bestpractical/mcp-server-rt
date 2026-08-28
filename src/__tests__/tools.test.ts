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

  // Setting a bare link field replaces every existing link of that type, which
  // is a destructive default for an AI. update_ticket offers only the
  // incremental forms.
  describe('link fields on update_ticket', () => {
    const relations = ['RefersTo', 'ReferredToBy', 'DependsOn', 'DependedOnBy', 'Parent', 'Child'];

    it.each(relations)('offers Add%s and Delete%s', (relation) => {
      const props = schemaProperties('update_ticket');
      expect(props).toHaveProperty(`Add${relation}`);
      expect(props).toHaveProperty(`Delete${relation}`);
    });

    it.each(relations)('does not offer a bare %s that would replace existing links', (relation) => {
      expect(schemaProperties('update_ticket')).not.toHaveProperty(relation);
    });

    it('forwards a single link id to add', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(['Ticket 7 refers to Ticket 9.']));
      await callTool(rt, 'update_ticket', { id: 7, AddRefersTo: 9 });

      expect(requestBody().AddRefersTo).toBe(9);
    });

    it('forwards multiple link ids to add', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(['Ticket 7 refers to Ticket 9.']));
      await callTool(rt, 'update_ticket', { id: 7, AddRefersTo: [9, 10] });

      expect(requestBody().AddRefersTo).toEqual([9, 10]);
    });

    it('forwards link ids to delete', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(['Ticket 7 no longer refers to Ticket 9.']));
      await callTool(rt, 'update_ticket', { id: 7, DeleteRefersTo: [9] });

      expect(requestBody().DeleteRefersTo).toEqual([9]);
    });

    it('rejects a bare link field instead of silently replacing links', async () => {
      await expect(callTool(rt, 'update_ticket', { id: 7, RefersTo: 9 })).rejects.toThrow(
        /AddRefersTo/,
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    // RT accepts several aliases for the same relation, all with replace
    // semantics, so the guard covers the whole typemap rather than just the
    // six names this tool used to expose.
    it.each(['Parents', 'Children', 'MemberOf', 'HasMember', 'Member', 'Members'])(
      'rejects the RT alias %s',
      async (alias) => {
        await expect(callTool(rt, 'update_ticket', { id: 7, [alias]: 9 })).rejects.toThrow(
          new RegExp(alias),
        );
        expect(mockFetch).not.toHaveBeenCalled();
      },
    );

    // create_ticket keeps the bare relations, because a new ticket has no links
    // to remove. The guard belongs to updateTicket alone, and moving it into one
    // of the helpers create and update share would silently break this.
    it('still forwards a bare link relation on create_ticket', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ id: '7' }));
      await callTool(rt, 'create_ticket', { Queue: 'General', Subject: 'Kickoff', RefersTo: 9 });

      expect(requestBody().RefersTo).toBe(9);
    });
  });

  // Ported with the queue-creation work, which had no tool-layer tests. The
  // structural checks matter most: a schema with no case is a tool that always
  // errors, and a case with no schema is a tool no AI can discover.
  describe('queue and group administration', () => {
    const ported = [
      'create_queue', 'update_queue', 'manage_queue_watchers',
      'list_groups', 'get_group', 'create_group',
      'list_group_members', 'add_group_members', 'remove_group_member',
      'create_custom_field', 'search_custom_fields', 'apply_custom_field',
      'add_custom_field_value', 'list_custom_field_applications',
      'remove_custom_field_application',
      'list_lifecycles', 'get_lifecycle', 'create_lifecycle', 'update_lifecycle',
      'update_lifecycle_maps', 'validate_lifecycle', 'delete_lifecycle',
      'grant_rights', 'revoke_right', 'list_rights', 'get_available_rights',
    ];

    it.each(ported)('%s is declared with an input schema', (name) => {
      expect(tool(name).inputSchema).toBeDefined();
    });

    it('every declared tool is reachable through callTool', async () => {
      // "Unknown tool" is raised before RT is touched, so it is the one failure
      // that proves a schema has no matching case. Any other error is fine here.
      mockFetch.mockReturnValue(mockResponse({}));
      const unreachable: string[] = [];
      for (const t of TOOLS) {
        try {
          await callTool(rt, t.name, { id: 1, query: 'x', path: '/tmp/x', name: 'x' });
        } catch (err) {
          if (/Unknown tool/.test(String(err))) unreachable.push(t.name);
        }
      }
      expect(unreachable).toEqual([]);
    });

    it('creates a queue from the fields it was given', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ id: '3' }));
      await callTool(rt, 'create_queue', { Name: 'Service Desk', Lifecycle: 'default' });

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/REST/2.0/queue');
      expect(options.method).toBe('POST');
      expect(requestBody()).toMatchObject({ Name: 'Service Desk', Lifecycle: 'default' });
    });

    it('adds group members by id', async () => {
      mockFetch.mockReturnValueOnce(mockResponse([]));
      await callTool(rt, 'add_group_members', { id: '7', members: [11, 12] });

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/REST/2.0/group/7/members');
      expect(options.method).toBe('PUT');
      expect(requestBody()).toEqual([11, 12]);
    });

    it('validates a lifecycle without saving it', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ valid: true }));
      await callTool(rt, 'validate_lifecycle', { name: 'helpdesk', initial: ['new'] });

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('/REST/2.0/lifecycle/helpdesk/validate');
    });

    it('scopes a global right grant to the global path', async () => {
      mockFetch.mockReturnValueOnce(mockResponse([]));
      await callTool(rt, 'grant_rights', {
        object_type: 'global',
        principal_type: 'group',
        principal_id: 'Everyone',
        rights: ['CreateTicket'],
      });

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('/REST/2.0/global/rights');
    });
  });

  // The other bundled-data reader: this tool answers from data/ rather than RT,
  // so a packaging mistake would show up as an empty grammar reference.
  describe('get_ticketsql_grammar', () => {
    it('returns the bundled grammar without calling RT', async () => {
      const grammar = await callTool(rt, 'get_ticketsql_grammar', {}) as string;

      expect(mockFetch).not.toHaveBeenCalled();
      expect(grammar.length).toBeGreaterThan(1000);
      expect(grammar).toMatch(/TicketSQL/i);
    });
  });

  // manifest.json's tool array is documentation for the extension listing —
  // tools/list is built from TOOLS — so drift costs discovery rather than
  // access. It had drifted by twelve entries before anyone noticed.
  describe('manifest.json', () => {
    it('lists exactly the implemented tools', async () => {
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const manifest = JSON.parse(
        readFileSync(join(process.cwd(), 'manifest.json'), 'utf8'),
      ) as { tools: { name: string }[] };

      expect(manifest.tools.map((t) => t.name).sort())
        .toEqual(TOOLS.map((t) => t.name).sort());
    });
  });

  describe('unknown tools', () => {
    it('throws for a tool name that does not exist', async () => {
      await expect(callTool(rt, 'no_such_tool', {})).rejects.toThrow('Unknown tool: no_such_tool');
    });
  });
});
