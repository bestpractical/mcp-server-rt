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

const TOOLS: Tool[] = [
  // -- Read-only tools --
  {
    name: 'search_tickets',
    description:
      "Search for tickets using RT's TicketSQL query language. " +
      "Example queries: \"Status = 'open'\", \"Queue = 'General' AND Owner = 'Nobody'\", \"Subject LIKE 'login'\"",
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
      'Use this before constructing complex queries to ensure valid syntax.',
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
        Status: { type: 'string', description: 'Initial status' },
        Priority: { type: 'integer', description: 'Ticket priority' },
        Owner: { type: 'string', description: 'Owner username' },
        Requestor: { description: 'Requestor username(s) (string or array of strings)' },
        Cc: { description: 'Cc username(s) (string or array of strings)' },
        AdminCc: { description: 'AdminCc username(s) (string or array of strings)' },
        CustomFields: { type: 'object', description: 'Custom field values as {CF_name: value}' },
        CustomRoles: { type: 'object', description: 'Custom role assignments as {role_name: username_or_array}' },
        Due: { type: 'string', description: 'Due datetime (format: "YYYY-MM-DD HH:MM:SS")' },
        Starts: { type: 'string', description: 'Starts datetime (format: "YYYY-MM-DD HH:MM:SS")' },
        Started: { type: 'string', description: 'Started datetime (format: "YYYY-MM-DD HH:MM:SS")' },
        Told: { type: 'string', description: 'Last Contact datetime (format: "YYYY-MM-DD HH:MM:SS")' },
        RefersTo: { description: 'RefersTo links (ticket ID, URL, or array)' },
        ReferredToBy: { description: 'ReferredToBy links (ticket ID, URL, or array)' },
        DependsOn: { description: 'DependsOn links (ticket ID, URL, or array)' },
        DependedOnBy: { description: 'DependedOnBy links (ticket ID, URL, or array)' },
        Parent: { description: 'Parent links (ticket ID, URL, or array)' },
        Child: { description: 'Child links (ticket ID, URL, or array)' },
      },
      required: ['Queue', 'Subject'],
    },
  },
  {
    name: 'update_ticket',
    description: 'Update fields on an existing ticket',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Ticket ID' },
        Subject: { type: 'string', description: 'New subject' },
        Status: { type: 'string', description: 'New status (e.g. open, resolved, rejected)' },
        Priority: { type: 'integer', description: 'New priority' },
        Owner: { type: 'string', description: 'New owner username' },
        Queue: { type: 'string', description: 'Move to this queue' },
        CustomFields: { type: 'object', description: 'Custom field values to update' },
        CustomRoles: { type: 'object', description: 'Custom role assignments as {role_name: username_or_array}' },
        Requestor: { description: 'Requestor username(s) — replaces existing list (string or array of strings)' },
        Cc: { description: 'Cc username(s) — replaces existing list (string or array of strings)' },
        AdminCc: { description: 'AdminCc username(s) — replaces existing list (string or array of strings)' },
        Due: { type: 'string', description: 'Due datetime (format: "YYYY-MM-DD HH:MM:SS")' },
        Starts: { type: 'string', description: 'Starts datetime (format: "YYYY-MM-DD HH:MM:SS")' },
        Started: { type: 'string', description: 'Started datetime (format: "YYYY-MM-DD HH:MM:SS")' },
        Told: { type: 'string', description: 'Last Contact datetime, labeled "Told" in RT (format: "YYYY-MM-DD HH:MM:SS")' },
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
        Content: { type: 'string', description: 'Comment text' },
        ContentType: {
          type: 'string',
          enum: ['text/plain', 'text/html'],
          description: 'Content MIME type (default text/plain)',
        },
        TimeTaken: { type: 'integer', description: 'Minutes of work time to log' },
      },
      required: ['id', 'Content'],
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
        Content: { type: 'string', description: 'Reply text' },
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
      },
      required: ['id', 'Content'],
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
      });

    case 'get_ticket':
      return rt.getTicket(args.id as number, {
        fields: args.fields as string | undefined,
      });

    case 'get_transaction':
      return rt.getTransaction(args.id as number);

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
        Content: args.Content as string,
        ContentType: args.ContentType as 'text/plain' | 'text/html' | undefined,
        TimeTaken: args.TimeTaken as number | undefined,
      });

    case 'add_reply':
      return rt.ticketCorrespond(args.id as number, {
        Content: args.Content as string,
        ContentType: args.ContentType as 'text/plain' | 'text/html' | undefined,
        TimeTaken: args.TimeTaken as number | undefined,
        Status: args.Status as string | undefined,
      });

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const server = new Server(
  { name: 'rt', version },
  { capabilities: { tools: {} } },
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
