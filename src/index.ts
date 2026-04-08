import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
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

// Load prompt files from the data/prompts directory bundled with the package.
// In the built output (dist/index.js), the data dir is at ../data relative to
// the script.  When running from source via ts-node / tsx the same relative
// path works because src/ and data/ are siblings under the project root.
const promptsDir = join(__dirname, '..', 'data', 'prompts');

interface PromptDef {
  name: string;
  title: string;
  description: string;
  content: string;
}

function loadPrompts(): PromptDef[] {
  const prompts: PromptDef[] = [];
  try {
    const createQueue = readFileSync(join(promptsDir, 'create-queue.md'), 'utf-8');
    prompts.push({
      name: 'create-queue',
      title: 'Create a Queue',
      description:
        'Interactive workflow consultant that helps RT admins design and create ' +
        'a new queue — discovers the workflow, recommends configuration, then ' +
        'executes the setup using RT tools.',
      content: createQueue,
    });
  } catch {
    // Prompt file not found — not fatal, just no prompts available.
  }
  return prompts;
}

const PROMPTS = loadPrompts();

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

  // -- Admin: Queue write tools --
  {
    name: 'create_queue',
    description:
      'Create a new RT queue. Returns the new queue ID and URL. ' +
      'After creating, use manage_queue_watchers to set up Cc/AdminCc members, ' +
      'grant_rights to configure permissions, and create_custom_field + ' +
      'apply_custom_field to add custom fields.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        Name:              { type: 'string', description: 'Queue name (required, must be unique)' },
        Description:       { type: 'string', description: 'Queue description' },
        CorrespondAddress: { type: 'string', description: 'Email address for ticket correspondence' },
        CommentAddress:    { type: 'string', description: 'Email address for internal comments' },
        Lifecycle:         { type: 'string', description: 'Lifecycle name (use list_lifecycles to see available options; default: "default")' },
        SLADisabled:       { type: 'boolean', description: 'Disable SLA for this queue (default: false)' },
      },
      required: ['Name'],
    },
  },
  {
    name: 'update_queue',
    description:
      "Update an existing queue's settings (name, description, lifecycle, " +
      'email addresses, etc.). To manage watchers (Cc, AdminCc), use manage_queue_watchers instead.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        id:                { type: 'string', description: 'Queue ID or name' },
        Name:              { type: 'string', description: 'New queue name' },
        Description:       { type: 'string', description: 'Queue description' },
        CorrespondAddress: { type: 'string', description: 'Email address for correspondence' },
        CommentAddress:    { type: 'string', description: 'Email address for comments' },
        Lifecycle:         { type: 'string', description: 'Lifecycle name' },
        SLADisabled:       { type: 'boolean', description: 'Disable SLA for this queue' },
        Disabled:          { type: 'boolean', description: 'Disable (archive) the queue' },
      },
      required: ['id'],
    },
  },
  {
    name: 'manage_queue_watchers',
    description:
      'Set the members of a queue role (Cc, AdminCc, or a multi-value custom role). ' +
      'Pass the complete member list — it replaces existing members. ' +
      'Members can be usernames, email addresses, or user/group IDs. ' +
      'Single-value custom roles (like Owner) cannot have queue-level members.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        id:          { type: 'string', description: 'Queue ID or name' },
        Cc:          { description: 'Cc members (username, email, or ID — string or array)' },
        AdminCc:     { description: 'AdminCc members (username, email, or ID — string or array)' },
        CustomRoles: { type: 'object', description: 'Custom role assignments as {"Role Name": ["user1", "user2"]}' },
      },
      required: ['id'],
    },
  },

  // -- Admin: Group tools --
  {
    name: 'list_groups',
    description:
      'List user-defined groups. Returns group names, descriptions, and IDs. ' +
      'Use this to check for existing groups before creating new ones.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        fields: {
          type: 'string',
          description: 'Comma-separated fields to include (default: Name,Description,Disabled)',
        },
      },
    },
  },
  {
    name: 'get_group',
    description: 'Get details about a specific group by ID or name',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Group ID or name' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_group',
    description:
      'Create a new user-defined group. After creating, use add_group_members ' +
      'to add users and grant_rights to give the group permissions on queues.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        Name:        { type: 'string', description: 'Group name (required, must be unique)' },
        Description: { type: 'string', description: 'Group description' },
      },
      required: ['Name'],
    },
  },
  {
    name: 'list_group_members',
    description: 'List the members of a group',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        id:          { type: 'string', description: 'Group ID or name' },
        recursively: { type: 'boolean', description: 'Include members of sub-groups (default: false)' },
        users:       { type: 'boolean', description: 'Only show user members (default: false)' },
        groups:      { type: 'boolean', description: 'Only show group members (default: false)' },
        per_page:    { type: 'integer', description: 'Results per page (max 100, default 20)' },
        page:        { type: 'integer', description: 'Page number (default 1)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'add_group_members',
    description:
      'Add one or more users to a group. Members are specified by user ID. ' +
      'Use lookup_user to find user IDs by name or email. ' +
      'Adding a user who is already a member has no effect.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        id:      { type: 'string', description: 'Group ID or name' },
        members: {
          type: 'array',
          items: { type: 'integer' },
          description: 'Array of user IDs to add',
        },
      },
      required: ['id', 'members'],
    },
  },
  {
    name: 'remove_group_member',
    description: 'Remove a user from a group',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        id:        { type: 'string', description: 'Group ID or name' },
        member_id: { type: 'string', description: 'User or group ID to remove' },
      },
      required: ['id', 'member_id'],
    },
  },

  // -- Admin: Lifecycle tools --
  {
    name: 'list_lifecycles',
    description:
      'List all available lifecycles. Each lifecycle defines the statuses ' +
      'and transitions for tickets in queues that use it.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['ticket', 'asset'], description: 'Filter by lifecycle type (default: all)' },
      },
    },
  },
  {
    name: 'get_lifecycle',
    description:
      "Get a lifecycle's full configuration including statuses (initial, active, inactive), " +
      'allowed transitions, default statuses, and which queues/catalogs use it.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Lifecycle name' },
      },
      required: ['name'],
    },
  },

  {
    name: 'create_lifecycle',
    description:
      'Create a new lifecycle. Optionally clone an existing one as a starting point. ' +
      'A lifecycle defines the statuses and transitions for tickets in queues that use it. ' +
      'After creating, use update_lifecycle to customize statuses and transitions.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        Name:  { type: 'string', description: 'Lifecycle name (required, must be unique)' },
        Type:  { type: 'string', enum: ['ticket', 'asset'], description: 'Lifecycle type (default: ticket)' },
        Clone: { type: 'string', description: 'Name of an existing lifecycle to clone as a starting point' },
      },
      required: ['Name'],
    },
  },
  {
    name: 'update_lifecycle',
    description:
      'Update a lifecycle\'s configuration. Pass the full lifecycle definition including ' +
      'initial, active, inactive status arrays, transitions, rights, actions, and defaults. ' +
      'Use get_lifecycle first to get the current config, then modify and send back. ' +
      'The lifecycle is validated before saving.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        name:       { type: 'string', description: 'Lifecycle name to update' },
        initial:    { type: 'array', items: { type: 'string' }, description: 'Initial statuses (tickets start here)' },
        active:     { type: 'array', items: { type: 'string' }, description: 'Active statuses (work in progress)' },
        inactive:   { type: 'array', items: { type: 'string' }, description: 'Inactive statuses (finished/closed)' },
        defaults:   { type: 'object', description: 'Default statuses (e.g. {on_create: "new", approved: "open"})' },
        transitions: { type: 'object', description: 'Allowed transitions as {from_status: [to_statuses]}. Use "" key for statuses available at creation.' },
        rights:     { type: 'object', description: 'Rights required for transitions as {"from -> to": "RightName"}' },
        actions:    { type: 'array', description: 'UI action buttons as [{from: "x", to: "y", label: "Label", update: "Respond|Comment"}]' },
        colors:     { type: 'object', description: 'Status colors as {"status_name": "#hex_color"}. Colors appear in the RT web UI next to status names.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_lifecycle_maps',
    description:
      'Update the status mappings between this lifecycle and other lifecycles. ' +
      'Maps define how statuses translate when tickets move between queues with different lifecycles. ' +
      'Format: {"lifecycle_a -> lifecycle_b": {"status_in_a": "status_in_b", ...}}',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Lifecycle name' },
        maps: { type: 'object', description: 'Status mappings between lifecycles' },
      },
      required: ['name', 'maps'],
    },
  },

  // -- Admin: Rights tools --
  {
    name: 'get_available_rights',
    description:
      'Get the rights that can be granted on a queue, custom field, group, class, ' +
      'catalog, or globally. Returns rights organized by category (General, Admin, Status).',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        object_type: {
          type: 'string',
          enum: ['queue', 'customfield', 'group', 'class', 'catalog', 'global'],
          description: 'Type of object',
        },
        object_id: { type: 'string', description: 'Object ID or name (not needed for global)' },
      },
      required: ['object_type'],
    },
  },
  {
    name: 'list_rights',
    description:
      'List rights currently granted on a queue, custom field, group, class, ' +
      'catalog, or globally. Can filter by user or group.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        object_type: {
          type: 'string',
          enum: ['queue', 'customfield', 'group', 'class', 'catalog', 'global'],
          description: 'Type of object',
        },
        object_id: { type: 'string', description: 'Object ID or name (not needed for global)' },
        user:      { type: 'string', description: 'Filter by user ID' },
        group:     { type: 'string', description: 'Filter by group ID' },
        per_page:  { type: 'integer', description: 'Results per page (max 100, default 20)' },
        page:      { type: 'integer', description: 'Page number (default 1)' },
      },
      required: ['object_type'],
    },
  },
  {
    name: 'grant_rights',
    description:
      'Grant rights on a queue, custom field, group, class, catalog, or globally. ' +
      'Specify a single right with Right + (User or Group), or pass an array of grants for bulk operation. ' +
      'Returns 409 if a right is already granted.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        object_type: {
          type: 'string',
          enum: ['queue', 'customfield', 'group', 'class', 'catalog', 'global'],
          description: 'Type of object',
        },
        object_id: { type: 'string', description: 'Object ID or name (not needed for global)' },
        Right:     { type: 'string', description: 'Right name (for single grant)' },
        User:      { type: 'string', description: 'Username or user ID to grant to (for single grant)' },
        Group:     { type: 'string', description: 'Group name or ID to grant to (for single grant)' },
        grants: {
          type: 'array',
          description: 'Array of grants for bulk operation. Each item: {Right, User or Group}',
          items: {
            type: 'object',
            properties: {
              Right: { type: 'string' },
              User:  { type: 'string' },
              Group: { type: 'string' },
            },
          },
        },
      },
      required: ['object_type'],
    },
  },
  {
    name: 'revoke_right',
    description:
      'Revoke a right from a user or group on a queue, custom field, group, class, ' +
      'catalog, or globally.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        object_type: {
          type: 'string',
          enum: ['queue', 'customfield', 'group', 'class', 'catalog', 'global'],
          description: 'Type of object',
        },
        object_id: { type: 'string', description: 'Object ID or name (not needed for global)' },
        Right:     { type: 'string', description: 'Right name to revoke' },
        User:      { type: 'string', description: 'User ID to revoke from' },
        Group:     { type: 'string', description: 'Group ID to revoke from' },
      },
      required: ['object_type', 'Right'],
    },
  },

  // -- Admin: Custom field tools --
  {
    name: 'search_custom_fields',
    description:
      'Search for existing custom fields. Use this before creating new ones to avoid duplicates. ' +
      'Search by Name, Type, LookupType, or any combination. ' +
      'Returns matching custom fields with their IDs, types, and descriptions.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        Name:       { type: 'string', description: 'Search by name (use LIKE operator for partial match)' },
        Type:       { type: 'string', description: 'Filter by field type (e.g. SelectSingle, FreeformSingle)' },
        LookupType: { type: 'string', description: 'Filter by what it applies to (e.g. RT::Queue-RT::Ticket)' },
        fields:     { type: 'string', description: 'Comma-separated fields to include (default: Name,Type,LookupType,Description,Disabled)' },
        per_page:   { type: 'integer', description: 'Results per page (max 100, default 20)' },
        page:       { type: 'integer', description: 'Page number (default 1)' },
      },
    },
  },
  {
    name: 'create_custom_field',
    description:
      'Create a new custom field. After creating, use apply_custom_field ' +
      'to apply it to specific queues or globally. Use add_custom_field_value ' +
      'to add values to Select-type fields.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        Name:       { type: 'string', description: 'Custom field name' },
        Type: {
          type: 'string',
          description: 'Field type',
          enum: [
            'FreeformSingle', 'FreeformMultiple',
            'SelectSingle', 'SelectMultiple',
            'TextSingle', 'TextMultiple',
            'WikiTextSingle', 'WikiTextMultiple',
            'BinarySingle', 'BinaryMultiple',
            'ImageSingle', 'ImageMultiple',
            'AutocompleteSingle', 'AutocompleteMultiple',
            'DateSingle', 'DateMultiple',
            'DateTimeSingle', 'DateTimeMultiple',
            'IPAddressSingle', 'IPAddressMultiple',
            'IPAddressRangeSingle', 'IPAddressRangeMultiple',
          ],
        },
        LookupType: {
          type: 'string',
          description: 'What object type this CF applies to',
          enum: [
            'RT::Queue-RT::Ticket',
            'RT::Queue-RT::Ticket-RT::Transaction',
            'RT::Queue',
            'RT::Class-RT::Article',
            'RT::Catalog-RT::Asset',
            'RT::User',
            'RT::Group',
          ],
        },
        Description: { type: 'string', description: 'Field description' },
        EntryHint:   { type: 'string', description: 'Hint text shown to users when entering values' },
        MaxValues:   { type: 'integer', description: '0 for unlimited, 1 for single-value (default depends on Type)' },
        Pattern:     { type: 'string', description: 'Regex validation pattern (e.g. "(?#Mandatory)." for required)' },
      },
      required: ['Name', 'Type', 'LookupType'],
    },
  },
  {
    name: 'add_custom_field_value',
    description:
      'Add one or more selectable values to a custom field (for Select, Autocomplete, etc. types). ' +
      'Pass a single value with Name, or multiple values with the Values array.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        id:          { type: 'integer', description: 'Custom field ID' },
        Name:        { type: 'string', description: 'Value name (for adding a single value)' },
        Description: { type: 'string', description: 'Value description' },
        SortOrder:   { type: 'integer', description: 'Sort position' },
        Category:    { type: 'string', description: 'Category (for grouped/cascaded values)' },
        Values: {
          type: 'array',
          description: 'Array of values to add in bulk. Each item: {Name, Description?, SortOrder?, Category?}',
          items: {
            type: 'object',
            properties: {
              Name:        { type: 'string', description: 'Value name' },
              Description: { type: 'string', description: 'Value description' },
              SortOrder:   { type: 'integer', description: 'Sort position' },
              Category:    { type: 'string', description: 'Category' },
            },
            required: ['Name'],
          },
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'apply_custom_field',
    description:
      "Apply a custom field to a specific object or globally. " +
      "The CF's LookupType determines what kind of object it can apply to " +
      '(e.g. a ticket CF applies to queues). Use ObjectId 0 to apply globally. ' +
      'Note: applying globally removes all specific object applications.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        id:       { type: 'integer', description: 'Custom field ID' },
        ObjectId: { type: 'integer', description: 'ID of the object to apply to (0 for global)' },
      },
      required: ['id', 'ObjectId'],
    },
  },
  {
    name: 'remove_custom_field_application',
    description:
      'Remove a custom field from a specific object or remove its global application. ' +
      'Use ObjectId 0 to remove the global application.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        id:       { type: 'integer', description: 'Custom field ID' },
        ObjectId: { type: 'integer', description: 'ID of the object to remove from (0 for global)' },
      },
      required: ['id', 'ObjectId'],
    },
  },
  {
    name: 'list_custom_field_applications',
    description:
      'List which objects a custom field is currently applied to, ' +
      'including whether it is applied globally.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        id:       { type: 'integer', description: 'Custom field ID' },
        per_page: { type: 'integer', description: 'Results per page (max 100, default 20)' },
        page:     { type: 'integer', description: 'Page number (default 1)' },
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

    case 'create_queue': {
      const { ...fields } = args;
      return rt.createQueue(fields);
    }

    case 'update_queue': {
      const { id, ...fields } = args;
      return rt.updateQueue(id as string, fields);
    }

    case 'manage_queue_watchers': {
      const { id, ...fields } = args;
      return rt.updateQueue(id as string, fields);
    }

    case 'list_groups':
      return rt.listGroups(args.fields as string | undefined);

    case 'get_group':
      return rt.getGroup(args.id as string);

    case 'create_group': {
      const { ...fields } = args;
      return rt.createGroup(fields);
    }

    case 'list_group_members':
      return rt.listGroupMembers(args.id as string, {
        recursively: args.recursively as boolean | undefined,
        users:       args.users as boolean | undefined,
        groups:      args.groups as boolean | undefined,
        per_page:    args.per_page as number | undefined,
        page:        args.page as number | undefined,
      });

    case 'add_group_members':
      return rt.addGroupMembers(args.id as string, args.members as number[]);

    case 'remove_group_member':
      return rt.removeGroupMember(args.id as string, args.member_id as string);

    case 'list_lifecycles':
      return rt.listLifecycles(args.type as string | undefined);

    case 'get_lifecycle':
      return rt.getLifecycle(args.name as string);

    case 'create_lifecycle':
      return rt.createLifecycle(args as Record<string, unknown>);

    case 'update_lifecycle': {
      const { name, ...config } = args;
      return rt.updateLifecycle(name as string, config);
    }

    case 'update_lifecycle_maps':
      return rt.updateLifecycleMaps(args.name as string, args.maps as Record<string, unknown>);

    case 'get_available_rights':
      return rt.getAvailableRights(args.object_type as string, args.object_id as string | undefined);

    case 'list_rights':
      return rt.listRights(args.object_type as string, args.object_id as string | undefined, {
        user:     args.user as string | undefined,
        group:    args.group as string | undefined,
        per_page: args.per_page as number | undefined,
        page:     args.page as number | undefined,
      });

    case 'grant_rights': {
      const { object_type, object_id, grants, ...single } = args;
      if (grants) {
        return rt.bulkRights(object_type as string, object_id as string | undefined, { grant: grants });
      }
      return rt.grantRight(object_type as string, object_id as string | undefined, single);
    }

    case 'revoke_right': {
      const { object_type, object_id, Right, User, Group } = args;
      if (User) {
        return rt.revokeRight(object_type as string, object_id as string | undefined, Right as string, 'user', User as string);
      }
      if (Group) {
        return rt.revokeRight(object_type as string, object_id as string | undefined, Right as string, 'group', Group as string);
      }
      throw new Error('revoke_right requires either User or Group');
    }

    case 'search_custom_fields': {
      const { Name, Type, LookupType, fields, per_page, page } = args;
      const query: Array<Record<string, string>> = [];
      if (Name) query.push({ field: 'Name', operator: 'LIKE', value: Name as string });
      if (Type) query.push({ field: 'Type', value: Type as string });
      if (LookupType) query.push({ field: 'LookupType', value: LookupType as string });
      return rt.searchCustomFields(query, {
        fields: (fields as string | undefined) ?? 'Name,Type,LookupType,Description,Disabled',
        per_page: per_page as number | undefined,
        page: page as number | undefined,
      });
    }

    case 'create_custom_field':
      return rt.createCustomField(args);

    case 'add_custom_field_value': {
      const { id, Values, ...fields } = args;
      if (Values && Array.isArray(Values)) {
        return rt.addCustomFieldValues(id as number, Values as object[]);
      }
      return rt.addCustomFieldValue(id as number, fields);
    }

    case 'apply_custom_field':
      return rt.applyCustomField(args.id as number, args.ObjectId as number);

    case 'remove_custom_field_application':
      return rt.removeCustomFieldApplication(args.id as number, args.ObjectId as number);

    case 'list_custom_field_applications':
      return rt.listCustomFieldApplications(args.id as number, {
        per_page: args.per_page as number | undefined,
        page:     args.page as number | undefined,
      });

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
    capabilities: { tools: {}, prompts: {} },
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
      'If the status update fails, ask the user what status their RT instance uses for completed reminders.\n\n' +
      'QUEUE SETUP: When helping create a new queue, follow this sequence:\n' +
      '(1) list_lifecycles to show available workflows,\n' +
      '(2) create_queue with name, description, lifecycle,\n' +
      '(3) list_groups to check for existing groups, then create_group if needed\n' +
      '    and add_group_members to populate staff groups,\n' +
      '(4) create custom fields if needed (create_custom_field + add_custom_field_value\n' +
      '    for select types + apply_custom_field),\n' +
      '(5) grant_rights to set up permissions for Everyone, Requestor role, and staff group,\n' +
      '(6) manage_queue_watchers to assign Cc/AdminCc members.\n' +
      'Always confirm the plan with the user before making changes.',
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: PROMPTS.map(({ name, title, description }) => ({
    name,
    title,
    description,
  })),
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name } = request.params;
  const prompt = PROMPTS.find((p) => p.name === name);
  if (!prompt) {
    throw new Error(`Unknown prompt: ${name}`);
  }
  return {
    description: prompt.description,
    messages: [
      {
        role: 'user' as const,
        content: { type: 'text' as const, text: prompt.content },
      },
    ],
  };
});

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
