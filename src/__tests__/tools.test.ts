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

// A plausible value for every parameter a tool declares required, so a test
// about something else is not tripped up by callTool's required-argument check.
function requiredArgs(t: Tool): Record<string, unknown> {
  const properties = (t.inputSchema.properties ?? {}) as Record<string, { type?: string }>;
  const values: Record<string, unknown> = {};
  for (const key of (t.inputSchema.required ?? []) as string[]) {
    const type = properties[key]?.type;
    values[key] = type === 'integer' ? 1 : type === 'array' ? [1] : type === 'object' ? {} : 'x';
  }
  return values;
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
      // Every declared parameter is supplied, since callTool now refuses a call
      // missing one and would never reach the case being tested.
      mockFetch.mockReturnValue(mockResponse({}));
      const unreachable: string[] = [];
      for (const t of TOOLS) {
        try {
          await callTool(rt, t.name, { ...requiredArgs(t), id: 1, path: '/tmp/x' });
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
        Right: 'CreateTicket',
        Group: 'Everyone',
      });

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('/REST/2.0/global/rights');
      expect(requestBody()).toEqual({ Right: 'CreateTicket', Group: 'Everyone' });
    });

    it('sends a bulk grant under the queue it names', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ granted: [], revoked: [] }));
      await callTool(rt, 'grant_rights', {
        object_type: 'queue',
        object_id: '8',
        grants: [{ Right: 'CreateTicket', Group: 'Everyone' }],
      });

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('/REST/2.0/queue/8/rights/bulk');
      expect(requestBody()).toEqual({ grant: [{ Right: 'CreateTicket', Group: 'Everyone' }] });
    });

    // Nothing validated tool arguments against the schemas that declared them,
    // so an omitted parameter reached RT and came back as its own error, or as
    // no information at all.
    describe('required arguments', () => {
      it('refuses a call missing a declared parameter without touching RT', async () => {
        await expect(callTool(rt, 'add_group_members', { id: '1248' })).rejects.toThrow(
          'add_group_members requires members',
        );
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('names every missing parameter, not just the first', async () => {
        await expect(callTool(rt, 'apply_custom_field', {})).rejects.toThrow(
          'apply_custom_field requires id and ObjectId',
        );
      });

      // Right cannot be marked required on grant_rights, because a grants array
      // carries its own, so the single-grant form is checked in the dispatch.
      it('refuses a single grant with no Right', async () => {
        await expect(
          callTool(rt, 'grant_rights', { object_type: 'queue', object_id: '8', Group: '1248' }),
        ).rejects.toThrow('grant_rights requires Right, or an array of grants');
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('refuses a single grant with no principal', async () => {
        await expect(
          callTool(rt, 'grant_rights', { object_type: 'queue', object_id: '8', Right: 'OwnTicket' }),
        ).rejects.toThrow('grant_rights requires either User or Group');
      });

      // Testing truthiness alone reported an empty principal as an omitted one,
      // telling the caller to pass a parameter they had passed.
      it('reports an empty principal as empty rather than missing', async () => {
        await expect(
          callTool(rt, 'revoke_right', { object_type: 'queue', object_id: '8', Right: 'ShowTicket', User: '' }),
        ).rejects.toThrow('revoke_right was given an empty User');
      });

      it('still reports an absent principal as missing', async () => {
        await expect(
          callTool(rt, 'revoke_right', { object_type: 'queue', object_id: '8', Right: 'ShowTicket' }),
        ).rejects.toThrow('revoke_right requires either User or Group');
      });

      it('revokes from the principal it was given', async () => {
        mockFetch.mockReturnValueOnce(mockResponse(null, 204));
        await callTool(rt, 'revoke_right', {
          object_type: 'queue',
          object_id: '8',
          Right: 'OwnTicket',
          Group: '1248',
        });

        const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(url).toContain('/REST/2.0/queue/8/rights/OwnTicket/group/1248');
        expect(options.method).toBe('DELETE');
      });
    });

    // Each of these descriptions once said something a live RT contradicted.
    // They are the only account of RT's behaviour the AI gets, so a wrong one
    // is worse than none.
    describe('descriptions match what RT returns', () => {
      // The description used to tell the AI a user member could not be named by
      // any tool here. get_group resolves one: its Members carry the username
      // as the id, where the members collection carries the numeric id.
      it('list_group_members sends the AI to get_group for member names', () => {
        const description = tool('list_group_members').description ?? '';

        expect(description).toContain('get_group');
        expect(description).not.toMatch(/cannot be resolved/i);
      });

      // The parameters said "User ID" and "Group ID" for both tools. RT resolves
      // a username on the revoke path and in the list filter — verified 204 and
      // a matching row — so only the group half was true. The group half matters
      // more, not less: a group name answers 404 on revoke, and in list_rights
      // matches nothing, which reads as "no rights granted" rather than an error.
      it('revoke_right says a group needs its ID and a user does not', () => {
        const properties = schemaProperties('revoke_right') as Record<string, { description: string }>;

        expect(properties.User.description).toMatch(/username/i);
        expect(properties.Group.description).toMatch(/numeric group ID/i);
        const description = tool('revoke_right').description ?? '';
        expect(description).toContain('grant_rights');
        // The two causes of a 404 are indistinguishable, so an AI that passed a
        // name reads it as "that right was not granted" and moves on.
        expect(description).toMatch(/never granted/i);
      });

      it('list_rights says the same of its filters', () => {
        const properties = schemaProperties('list_rights') as Record<string, { description: string }>;

        expect(properties.user.description).toMatch(/username/i);
        expect(properties.group.description).toMatch(/numeric group ID/i);
        expect(properties.group.description).toMatch(/empty list rather than an error/i);
      });

      // grant_rights resolves either form, so its own descriptions stay as they
      // are — the asymmetry is what revoke_right has to spell out.
      it('grant_rights still says a group can be named', () => {
        const properties = schemaProperties('grant_rights') as Record<string, { description: string }>;

        expect(properties.Group.description).toMatch(/name or ID/i);
      });

      // The description named General, Admin and Status, and omitted Staff. All
      // four are real, but they are not a fixed set: a group offers only Admin
      // and Staff, and Status appears on a queue only once a lifecycle reserves
      // a transition behind a named right — RT registers those under Status via
      // RT::Queue->AddRight, so a custom sign-off right shows up there and
      // nowhere else.
      it('get_available_rights names the categories RT actually returns', () => {
        const description = tool('get_available_rights').description ?? '';

        for (const category of ['General', 'Staff', 'Admin', 'Status']) {
          expect(description).toContain(category);
        }
      });

      // Naming the four is not enough on its own: the set varies by object, so
      // the AI has to be told to read them back rather than rely on the list.
      it('get_available_rights says the categories vary by object', () => {
        const description = tool('get_available_rights').description ?? '';

        expect(description).toMatch(/depends on the object/i);
        expect(description).toMatch(/read the categories from the response/i);
      });

      // The Status category is only useful if the AI knows what puts a right
      // there — a lifecycle gating a transition.
      it('get_available_rights ties the Status category to lifecycle transitions', () => {
        const description = tool('get_available_rights').description ?? '';
        const clause = description.match(/[^.]*Status category[^.]*/)?.[0] ?? '';

        expect(clause).toMatch(/transition/i);
        expect(clause).toMatch(/lifecycle/i);
      });

      // RT does fill in a missing defaults.on_create, but in memory as it loads
      // the config, so get_lifecycle still shows the key absent. An AI told only
      // that RT backfills it reads that absence as damage and tries to repair it.
      it('update_lifecycle says the filled-in defaults stay absent from get_lifecycle', () => {
        const description = tool('update_lifecycle').description ?? '';

        expect(description).toContain('defaults.on_create');
        expect(description).toContain('get_lifecycle');
        expect(description).toMatch(/in memory/i);
      });
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

    // The grammar is bundled, so it only tracks RT if someone updates it. The
    // description names an RT version, and 6.0.3 is the release that added
    // searching on a role member's custom fields — if the grammar stops
    // covering that, the two have drifted apart again.
    it('covers the RT version its description claims', async () => {
      const grammar = await callTool(rt, 'get_ticketsql_grammar', {}) as string;
      const claimed = tool('get_ticketsql_grammar').description?.match(/RT (\d+\.\d+\.\d+)/)?.[1];

      expect(claimed).toBe('6.0.3');
      expect(grammar).toMatch(/CustomField/);
      expect(grammar).toMatch(/Owner\.CustomField|Requestor\.CustomField/);
      expect(grammar).toMatch(/6\.0\.3/);
    });

    // An unknown custom role makes the condition vanish rather than erroring, so
    // the query silently returns whatever the rest of it matches. Saying it
    // "matches everything" would be wrong: that only happens when the dropped
    // clause was the entire query.
    it('warns that an unknown custom role drops the condition', async () => {
      const grammar = await callTool(rt, 'get_ticketsql_grammar', {}) as string;
      const clause = (grammar.match(/unknown \*\*custom role\*\*[\s\S]*?wrong\./)?.[0] ?? '')
        .replace(/\s+/g, ' ');

      expect(clause).toMatch(/remaining conditions/i);
      expect(clause).not.toMatch(/matches \*\*every ticket\*\*/i);
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
