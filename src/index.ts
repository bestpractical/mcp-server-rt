import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { RTClient } from './rt-client.js';
import { version } from '../package.json';

// Validate required environment variables at startup so the user gets a clear
// error before the MCP handshake rather than a cryptic failure on first tool call.
function validateEnv(): void {
  const missing = [];
  if (!process.env.RT_URL) missing.push('RT_URL');
  if (!process.env.RT_TOKEN) missing.push('RT_TOKEN');

  if (missing.length > 0) {
    process.stderr.write(
      `mcp-server-rt: Required environment variable(s) not set: ${missing.join(', ')}\n\n` +
        `Set them in your .mcp.json configuration:\n\n` +
        `  {\n` +
        `    "mcpServers": {\n` +
        `      "rt": {\n` +
        `        "type": "stdio",\n` +
        `        "command": "mcp-server-rt",\n` +
        `        "env": {\n` +
        `          "RT_URL": "http://your-rt.example.com",\n` +
        `          "RT_TOKEN": "your-auth-token"\n` +
        `        }\n` +
        `      }\n` +
        `    }\n` +
        `  }\n\n` +
        `Create an auth token in RT under: Logged in as → Settings → Auth Tokens\n`,
    );
    process.exit(1);
  }
}

validateEnv();

const rt = new RTClient(process.env.RT_URL!, process.env.RT_TOKEN!);
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const TOOLS: Tool[] = [
  // -- Read-only tools --
  {
    name: 'search_tickets',
    description:
      "Search for tickets using RT's TicketSQL query language. " +
      'TicketSQL has non-obvious syntax — consult get_ticketsql_grammar before writing any query ' +
      'involving Status, date conditions, custom fields, or special values. ' +
      'Key syntax notes: Status has meta-values __Active__ and __Inactive__ that match all active/inactive ' +
      'statuses across lifecycles (e.g. Status = \'__Active__\' rather than Status = \'open\'). ' +
      "Basic examples: \"Queue = 'General' AND Owner = 'Nobody'\", \"Subject LIKE 'login'\". " +
      'Always include fields=Subject,Status,Queue,Owner,Requestor,Priority,LastUpdated,Due unless context calls for a different set.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'TicketSQL query string' },
        orderby: { type: 'string', description: 'Field to sort by (e.g. Created, Priority, id)' },
        order: { type: 'string', enum: ['ASC', 'DESC'], description: 'Sort direction' },
        per_page: { type: 'integer', description: 'Results per page (max 100, default 20)' },
        page: { type: 'integer', description: 'Page number (default 1)' },
        fields: { type: 'string', description: 'Comma-separated list of extra fields to include' },
        subfields: { type: 'object', description: 'Expand object fields inline, e.g. {"Queue": "Name", "Owner": "Name,EmailAddress"}' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_ticket',
    description: 'Get detailed information about a specific ticket by its ID',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Ticket ID' },
        fields: { type: 'string', description: 'Comma-separated list of extra fields to include' },
        subfields: { type: 'object', description: 'Expand object fields inline, e.g. {"Queue": "Name", "Owner": "Name,EmailAddress"}' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_transaction',
    description:
      'Get the full details of a single transaction including decoded message content. ' +
      'Use this after get_ticket_history to read the actual text of a reply or comment.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Transaction ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_ticket_history',
    description:
      'Get the transaction history for a ticket. Returns a list of transactions ' +
      '(comments, replies, status changes, etc.)',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Ticket ID' },
        per_page: { type: 'integer', description: 'Results per page (max 100, default 20)' },
        page: { type: 'integer', description: 'Page number (default 1)' },
        fields: { type: 'string', description: 'Comma-separated list of extra fields to include' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_ticket_attachments',
    description: 'List all attachments on a ticket (names, MIME types, sizes, IDs)',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Ticket ID' },
        per_page: { type: 'integer', description: 'Results per page (max 100, default 20)' },
        page: { type: 'integer', description: 'Page number (default 1)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_attachment',
    description:
      'Retrieve a single attachment by ID. Text content is returned decoded; ' +
      'binary content is returned as MIME Base64. Use get_ticket_attachments or ' +
      'get_transaction to find attachment IDs.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Attachment ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'save_attachment',
    description:
      'Save an attachment to a local file. The MCP server writes the file directly, ' +
      'so this works on any platform. If path is a directory, the original filename is used.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Attachment ID' },
        path: { type: 'string', description: 'Destination file path or directory' },
      },
      required: ['id', 'path'],
    },
  },
  {
    name: 'get_queue',
    description: 'Get details about a specific queue by ID or name',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Queue ID or name' },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_queues',
    description: 'List all available queues',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        fields: {
          type: 'string',
          description: 'Comma-separated fields to include (default: Name,Description,Lifecycle,Disabled,SubjectTag,CorrespondAddress,CommentAddress)',
        },
      },
    },
  },

  // -- Reference tools --
  {
    name: 'get_ticketsql_grammar',
    description:
      'Returns the TicketSQL grammar reference for RT 6.0.2. ' +
      'Consult this before writing any TicketSQL query — especially for Status conditions, ' +
      'date/time fields, custom fields, and link fields where syntax is non-obvious.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
  },

  // -- Current user --
  {
    name: 'get_current_user',
    description: 'Get the RT user account associated with the configured auth token. Use this to determine who "I" or "me" refers to when the user asks to assign tickets to themselves, find their own tickets, etc.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
  },

  // -- User tools --
  {
    name: 'lookup_user',
    description: 'Search for RT users by name or email address',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name or email fragment to search for' },
        per_page: { type: 'integer', description: 'Results per page (max 100, default 20)' },
        page: { type: 'integer', description: 'Page number (default 1)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_queue_fields',
    description:
      'Get custom fields (with types and allowed values) and lifecycle name for a queue',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Queue ID or name' },
      },
      required: ['id'],
    },
  },

  // -- Write tools --
  {
    name: 'create_ticket',
    description: 'Create a new ticket in RT',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        Queue: { type: 'string', description: 'Queue name or ID' },
        Subject: { type: 'string', description: 'Ticket subject' },
        Content: { type: 'string', description: 'Ticket body content' },
        ContentType: {
          type: 'string',
          enum: ['text/plain', 'text/html'],
          description: 'Content MIME type (default text/plain)',
        },
        Description: { type: 'string', description: 'Ticket description' },
        Type: { type: 'string', description: 'Ticket type (e.g. "ticket", "reminder")' },
        Status: { type: 'string', description: 'Initial status' },
        Priority: { type: 'integer', description: 'Ticket priority' },
        Owner: { type: 'string', description: 'Owner username' },
        Requestor: { description: 'Requestor username(s) (string or array of strings)' },
        Cc: { description: 'Cc username(s) (string or array of strings)' },
        AdminCc: { description: 'AdminCc username(s) (string or array of strings)' },
        CustomFields: { type: 'object', description: 'Custom field values as {CF_name: value}' },
        CustomRoles: { type: 'object', description: 'Custom role assignments as {role_name: username_or_array}' },
        Due: { type: 'string', description: 'Due datetime (format: "YYYY-MM-DD HH:MM:SS" in local time)' },
        Starts: { type: 'string', description: 'Starts datetime (format: "YYYY-MM-DD HH:MM:SS" in local time)' },
        Started: { type: 'string', description: 'Started datetime (format: "YYYY-MM-DD HH:MM:SS" in local time)' },
        Told: { type: 'string', description: 'Last Contact datetime (format: "YYYY-MM-DD HH:MM:SS" in local time)' },
        RefersTo: { description: 'RefersTo links (ticket ID, URL, or array)' },
        ReferredToBy: { description: 'ReferredToBy links (ticket ID, URL, or array)' },
        DependsOn: { description: 'DependsOn links (ticket ID, URL, or array)' },
        DependedOnBy: { description: 'DependedOnBy links (ticket ID, URL, or array)' },
        Parent: { description: 'Parent links (ticket ID, URL, or array)' },
        Child: { description: 'Child links (ticket ID, URL, or array)' },
        Attachments: {
          type: 'array',
          description: 'Files to attach. Provide either FilePath (local file path, server reads and encodes it) or FileContent (pre-encoded MIME Base64). FileName and FileType are optional with FilePath and are inferred from the path.',
          items: {
            type: 'object',
            properties: {
              FilePath: { type: 'string', description: 'Absolute path to a local file — server reads and encodes it' },
              FileName: { type: 'string', description: 'File name (defaults to basename of FilePath)' },
              FileType: { type: 'string', description: 'MIME type (auto-detected from extension when using FilePath)' },
              FileContent: { type: 'string', description: 'MIME Base64-encoded content (use when FilePath is not available)' },
            },
          },
        },
      },
      required: ['Queue', 'Subject'],
    },
  },
  {
    name: 'update_ticket',
    description: 'Update an existing ticket. Pass each property to change as a top-level parameter (e.g. Due, Status, Owner) — do NOT use a nested "fields" object.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Ticket ID' },
        Subject: { type: 'string', description: 'New subject' },
        Type: { type: 'string', description: 'Ticket type (e.g. "ticket", "reminder")' },
        Description: { type: 'string', description: 'Ticket description' },
        Status: { type: 'string', description: 'New status (e.g. open, resolved, rejected)' },
        Priority: { type: 'integer', description: 'New priority' },
        Owner: { type: 'string', description: 'New owner username' },
        Queue: { type: 'string', description: 'Move to this queue' },
        CustomFields: { type: 'object', description: 'Custom field values to update' },
        CustomRoles: { type: 'object', description: 'Custom role assignments as {role_name: username_or_array}' },
        Requestor: { description: 'Requestor username(s) — replaces existing list (string or array of strings)' },
        Cc: { description: 'Cc username(s) — replaces existing list (string or array of strings)' },
        AdminCc: { description: 'AdminCc username(s) — replaces existing list (string or array of strings)' },
        Due: { type: 'string', description: 'Due datetime (format: "YYYY-MM-DD HH:MM:SS" in local time)' },
        Starts: { type: 'string', description: 'Starts datetime (format: "YYYY-MM-DD HH:MM:SS" in local time)' },
        Started: { type: 'string', description: 'Started datetime (format: "YYYY-MM-DD HH:MM:SS" in local time)' },
        Told: { type: 'string', description: 'Last Contact datetime, labeled "Told" in RT (format: "YYYY-MM-DD HH:MM:SS" in local time)' },
        RefersTo: { description: 'Set RefersTo links (ticket ID or array of IDs)' },
        ReferredToBy: { description: 'Set ReferredToBy links (ticket ID or array of IDs)' },
        DependsOn: { description: 'Set DependsOn links (ticket ID or array of IDs)' },
        DependedOnBy: { description: 'Set DependedOnBy links (ticket ID or array of IDs)' },
        Parent: { description: 'Set Parent links (ticket ID or array of IDs)' },
        Child: { description: 'Set Child links (ticket ID or array of IDs)' },
        AddRefersTo: { description: 'Add RefersTo links without removing existing ones' },
        AddReferredToBy: { description: 'Add ReferredToBy links without removing existing ones' },
        AddDependsOn: { description: 'Add DependsOn links without removing existing ones' },
        AddDependedOnBy: { description: 'Add DependedOnBy links without removing existing ones' },
        AddParent: { description: 'Add Parent links without removing existing ones' },
        AddChild: { description: 'Add Child links without removing existing ones' },
        DeleteRefersTo: { description: 'Remove specific RefersTo links' },
        DeleteReferredToBy: { description: 'Remove specific ReferredToBy links' },
        DeleteDependsOn: { description: 'Remove specific DependsOn links' },
        DeleteDependedOnBy: { description: 'Remove specific DependedOnBy links' },
        DeleteParent: { description: 'Remove specific Parent links' },
        DeleteChild: { description: 'Remove specific Child links' },
      },
      required: ['id'],
    },
  },
  {
    name: 'add_comment',
    description: 'Add an internal comment to a ticket (not visible to the requestor)',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Ticket ID' },
        Content: { type: 'string', description: 'Comment text (optional if Attachments provided)' },
        ContentType: {
          type: 'string',
          enum: ['text/plain', 'text/html'],
          description: 'Content MIME type (default text/plain)',
        },
        TimeTaken: { type: 'integer', description: 'Minutes of work time to log' },
        Attachments: {
          type: 'array',
          description: 'Files to attach. Provide either FilePath (local file path, server reads and encodes it) or FileContent (pre-encoded MIME Base64). FileName and FileType are optional with FilePath and are inferred from the path.',
          items: {
            type: 'object',
            properties: {
              FilePath: { type: 'string', description: 'Absolute path to a local file — server reads and encodes it' },
              FileName: { type: 'string', description: 'File name (defaults to basename of FilePath)' },
              FileType: { type: 'string', description: 'MIME type (auto-detected from extension when using FilePath)' },
              FileContent: { type: 'string', description: 'MIME Base64-encoded content (use when FilePath is not available)' },
            },
          },
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'add_reply',
    description: 'Send a reply (correspondence) on a ticket, visible to the requestor',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Ticket ID' },
        Content: { type: 'string', description: 'Reply text (optional if Attachments provided)' },
        ContentType: {
          type: 'string',
          enum: ['text/plain', 'text/html'],
          description: 'Content MIME type (default text/plain)',
        },
        TimeTaken: { type: 'integer', description: 'Minutes of work time to log' },
        Status: {
          type: 'string',
          description: 'Optionally change ticket status (e.g. resolved)',
        },
        Attachments: {
          type: 'array',
          description: 'Files to attach. Provide either FilePath (local file path, server reads and encodes it) or FileContent (pre-encoded MIME Base64). FileName and FileType are optional with FilePath and are inferred from the path.',
          items: {
            type: 'object',
            properties: {
              FilePath: { type: 'string', description: 'Absolute path to a local file — server reads and encodes it' },
              FileName: { type: 'string', description: 'File name (defaults to basename of FilePath)' },
              FileType: { type: 'string', description: 'MIME type (auto-detected from extension when using FilePath)' },
              FileContent: { type: 'string', description: 'MIME Base64-encoded content (use when FilePath is not available)' },
            },
          },
        },
      },
      required: ['id'],
    },
  },
];

type Args = Record<string, unknown>;

async function callTool(name: string, args: Args): Promise<unknown> {
  switch (name) {
    case 'search_tickets':
      return rt.searchTickets(args.query as string, {
        orderby: args.orderby as string | undefined,
        order: args.order as 'ASC' | 'DESC' | undefined,
        per_page: args.per_page as number | undefined,
        page: args.page as number | undefined,
        fields: args.fields as string | undefined,
        subfields: args.subfields as Record<string, string> | undefined,
      });

    case 'get_ticket':
      return rt.getTicket(args.id as number, {
        fields: args.fields as string | undefined,
        subfields: args.subfields as Record<string, string> | undefined,
      });

    case 'get_transaction':
      return rt.getTransaction(args.id as number);

    case 'get_ticket_attachments':
      return rt.getTicketAttachments(args.id as number, {
        per_page: args.per_page as number | undefined,
        page: args.page as number | undefined,
      });

    case 'get_attachment':
      return rt.getAttachment(args.id as number);

    case 'save_attachment':
      return rt.saveAttachment(args.id as number, args.path as string);

    case 'get_ticket_history':
      return rt.getTicketHistory(args.id as number, {
        per_page: args.per_page as number | undefined,
        page: args.page as number | undefined,
        fields: args.fields as string | undefined,
      });

    case 'get_queue':
      return rt.getQueue(args.id as string);

    case 'list_queues':
      return rt.listQueues(args.fields as string | undefined);

    case 'get_ticketsql_grammar':
      return readFileSync(join(__dirname, '../data/ticketsql_grammar.md'), 'utf8');

    case 'get_current_user':
      return rt.getCurrentUser();

    case 'lookup_user':
      return rt.lookupUser(args.query as string, {
        per_page: args.per_page as number | undefined,
        page: args.page as number | undefined,
      });

    case 'get_queue_fields':
      return rt.getQueueFields(args.id as string);

    case 'create_ticket': {
      const { Queue, Subject, ...rest } = args;
      return rt.createTicket({ Queue: Queue as string, Subject: Subject as string, ...rest });
    }

    case 'update_ticket': {
      const { id, ...fields } = args;
      return rt.updateTicket(id as number, fields);
    }

    case 'add_comment':
      return rt.ticketComment(args.id as number, {
        Content: args.Content as string | undefined,
        ContentType: args.ContentType as 'text/plain' | 'text/html' | undefined,
        TimeTaken: args.TimeTaken as number | undefined,
        Attachments: args.Attachments as import('./rt-client.js').AttachmentInput[] | undefined,
      });

    case 'add_reply':
      return rt.ticketCorrespond(args.id as number, {
        Content: args.Content as string | undefined,
        ContentType: args.ContentType as 'text/plain' | 'text/html' | undefined,
        TimeTaken: args.TimeTaken as number | undefined,
        Status: args.Status as string | undefined,
        Attachments: args.Attachments as import('./rt-client.js').AttachmentInput[] | undefined,
      });

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const server = new Server(
  { name: 'rt', version },
  {
    capabilities: { tools: {} },
    instructions:
      'When presenting RT tickets to the user, always link to the web UI ' +
      `(${process.env.RT_URL}/Ticket/Display.html?id=TICKET_ID) rather than ` +
      'the REST API endpoint (/REST/2.0/ticket/TICKET_ID). ' +
      `The user's local timezone is ${timezone}. When setting date fields (Due, Starts, Started, Told), ` +
      'always provide dates in the user\'s local time — the server converts them to UTC automatically.\n\n' +
      'TICKET DISPLAY: When presenting search results, always request ' +
      'fields=Subject,Status,Queue,Owner,Requestor,Priority,LastUpdated,Due unless context calls for a different set ' +
      '(e.g. add TimeLeft when SLA is relevant, drop Requestor for personal task searches). ' +
      'Always include subfields={"Queue":"Name","Owner":"Name"} to get human-readable names instead of object stubs. ' +
      'Present ticket results on one line if it fits on the current display. ' +
      'Use a two-row display if needed to show all of the requested ticket fields. ' +
      'Omit empty or unset fields rather than showing blank values.\n\n' +
      'REMINDERS: Reminders are tickets with Type = \'reminder\'. They are mini-tasks linked to a parent ticket ' +
      'via a RefersTo relationship and are displayed in the context of that parent ticket in the RT UI. ' +
      'Reminders have an Owner field — "set a reminder" means setting one for the current user. ' +
      'Always default the Owner of new reminders to the current user (use get_current_user) unless the user explicitly says otherwise. ' +
      'When searching for reminders, always scope to Owner = current user by default unless the user asks for reminders belonging to someone else.\n' +
      'To find reminders for a specific ticket, use search_tickets with TicketSQL: ' +
      '`Type = \'reminder\' AND RefersTo = \'TICKET_ID\' AND Owner = \'USERNAME\'`.\n' +
      'Always link a new reminder to a parent ticket via RefersTo. If the context does not make clear which ticket to link to, ask the user before creating.\n' +
      'Reminders have exactly two states: active and inactive. ' +
      'By default the active status is "open" and the inactive status is "resolved", ' +
      'but these can be customized per RT installation. ' +
      'The available status transitions are visible in the _hyperlinks of a get_ticket response (ref = "lifecycle"), ' +
      'which can confirm the inactive status name if needed. ' +
      'When a user asks to close, complete, dismiss, or mark a reminder as done on a ticket: ' +
      '(1) search for active reminders linked to that ticket owned by the current user, ' +
      '(2) if there is exactly one, update its status to the inactive status (default: "resolved"); ' +
      'if there are multiple, ask the user which one to close. ' +
      'If the status update fails, ask the user what status their RT instance uses for completed reminders.',
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    const result = await callTool(name, args as Args);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: message }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
server.connect(transport).catch((err: unknown) => {
  process.stderr.write(`mcp-server-rt: Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
