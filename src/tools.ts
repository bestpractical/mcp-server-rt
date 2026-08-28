import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
import { dataFile } from './data-files.js';
import { AttachmentInput, DEFAULT_FIELDS, RTClient } from './rt-client.js';

export const TOOLS: Tool[] = [
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
      'A useful default field set is sent automatically, with Queue and Owner expanded to names, ' +
      'so pass fields or subfields only when the context calls for a different set.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'TicketSQL query string' },
        orderby: { type: 'string', description: 'Field to sort by (e.g. Created, Priority, id)' },
        order: { type: 'string', enum: ['ASC', 'DESC'], description: 'Sort direction' },
        per_page: { type: 'integer', description: 'Results per page (max 100, default 20)' },
        page: { type: 'integer', description: 'Page number (default 1)' },
        fields: { type: 'string', description: `Comma-separated fields to include. Replaces the default (${DEFAULT_FIELDS.tickets}) rather than adding to it.` },
        subfields: { type: 'object', description: `Expand object fields inline, e.g. {"Queue": "Name", "Owner": "Name,EmailAddress"}. Replaces the default (${JSON.stringify(DEFAULT_FIELDS.ticketSubfields)}), so list every field you want expanded.` },
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
      '(comments, replies, status changes, etc.). Most entries name the field changed ' +
      'in Field and carry its old and new values. Two kinds do not. An owner or watcher ' +
      'change (Type SetWatcher, AddWatcher or DelWatcher) puts a numeric user ID in ' +
      'OldValue and NewValue, and no tool here turns one into a name — describe the ' +
      'change without inventing one. A custom field change (Type CustomField) puts the ' +
      "field's numeric ID in Field rather than its name, which get_queue_fields maps " +
      'back; its OldValue and NewValue hold the values as usual, while OldReference and ' +
      'NewReference are row IDs that nothing here resolves.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Ticket ID' },
        per_page: { type: 'integer', description: 'Results per page (max 100, default 20)' },
        page: { type: 'integer', description: 'Page number (default 1)' },
        fields: { type: 'string', description: `Comma-separated fields to include. Replaces the default (${DEFAULT_FIELDS.history}) rather than adding to it.` },
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
        fields: { type: 'string', description: `Comma-separated fields to include. Replaces the default (${DEFAULT_FIELDS.attachments}) rather than adding to it.` },
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
          description: `Comma-separated fields to include. Replaces the default (${DEFAULT_FIELDS.queues}) rather than adding to it.`,
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
        fields: { type: 'string', description: `Comma-separated fields to include. Replaces the default (${DEFAULT_FIELDS.users}) rather than adding to it.` },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_queue_fields',
    description:
      'Get custom fields (with types and allowed values) and lifecycle name for a queue. ' +
      'Returns three separate groups, because RT applies custom fields to three different ' +
      'things: CustomFields are set on tickets in the queue (this is what you want when ' +
      'creating or updating a ticket), QueueCustomFields are set on the queue itself and ' +
      'include the queue\'s CurrentValues (RTIR uses these for RTIR Constituency and RTIR ' +
      'default WHOIS server), and TransactionCustomFields are set on individual comments and ' +
      'replies. When the user asks what custom fields a queue has, report all three groups and ' +
      'say which is which. ' +
      'Each field carries a ContentFormat saying how its value is rendered: "html" (send markup; a ' +
      'bare newline shows nothing), "plain-text-multiline" (send plain text; newlines become line ' +
      'breaks), "plain-text" (shown exactly as typed), "wikitext" (wiki markup), "file" (an ' +
      'uploaded image or attachment rather than text), "date", or "datetime" (send local time; RT ' +
      'reads it in the user\'s timezone). Check it before writing a multi-line or formatted value. ' +
      'Every applied field is always listed. If RT permits seeing that a field is applied but ' +
      'not reading the field itself, the entry carries id, Name and a DetailsUnavailable ' +
      'message explaining why; a QueueCustomFields entry still carries its CurrentValues too. ' +
      'The field is still applied to the queue either way, and a field in CustomFields can ' +
      'still be set on a ticket. Tell the user which fields came back without details rather ' +
      'than reporting them as missing.',
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
        Description: { type: 'string', description: 'Ticket description. This field is HTML: use <p> for paragraphs and <br /> for single line breaks, because a bare newline renders as nothing. Plain text with line breaks and no markup is converted to paragraphs for you. Write angle brackets that are not markup as &lt; and &gt; — RT silently deletes any tag it does not allow along with the text inside it, so &lt;bob@example.com&gt; sent as <bob@example.com> is lost. A bare & is safe as typed.' },
        Type: { type: 'string', description: 'Ticket type (e.g. "ticket", "reminder")' },
        Status: { type: 'string', description: 'Initial status' },
        Priority: {
          type: ['integer', 'string'],
          description: 'Ticket priority, as a number or as one of the labels this RT displays (e.g. Low, Medium, High). Labels are configured per queue and are case-sensitive, so use the exact label RT shows; when in doubt pass a number. RT does not reject a label it does not recognize, and does not reject a label at all on an installation with priority labels turned off: it sets the priority to 0, the lowest, and reports success. So read the PrioritySet message in the response, which names the label RT actually applied, and tell the user if it is not the one you asked for. A label is applied in a follow-up update because RT cannot resolve one while creating a ticket; if that step fails the response carries PriorityNotSet instead and the ticket is created without the priority.',
        },
        Owner: { type: 'string', description: 'Owner username' },
        Requestor: { description: 'Requestor username(s) (string or array of strings)' },
        Cc: { description: 'Cc username(s) (string or array of strings)' },
        AdminCc: { description: 'AdminCc username(s) (string or array of strings)' },
        CustomFields: { type: 'object', description: 'Custom field values as {CF_name: value}. How a value is displayed depends on the field: call get_queue_fields and check each field\'s ContentFormat before writing a multi-line or formatted value.' },
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
    description: 'Update an existing ticket. Pass each property to change as a top-level parameter (e.g. Due, Status, Owner) — do NOT use a nested "fields" object. ' +
      'Links are changed only with the Add/Delete fields below: a bare relation name such as RefersTo, Parent or Children is refused, because RT would treat it as the complete list for that relation and silently remove every other link of the type.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Ticket ID' },
        Subject: { type: 'string', description: 'New subject' },
        Type: { type: 'string', description: 'Ticket type (e.g. "ticket", "reminder")' },
        Description: { type: 'string', description: 'Ticket description. This field is HTML: use <p> for paragraphs and <br /> for single line breaks, because a bare newline renders as nothing. Plain text with line breaks and no markup is converted to paragraphs for you. Write angle brackets that are not markup as &lt; and &gt; — RT silently deletes any tag it does not allow along with the text inside it, so &lt;bob@example.com&gt; sent as <bob@example.com> is lost. A bare & is safe as typed.' },
        Status: { type: 'string', description: 'New status (e.g. open, resolved, rejected)' },
        Priority: {
          type: ['integer', 'string'],
          description: 'New priority, as a number or as one of the labels this RT displays (e.g. Low, Medium, High). Labels are configured per queue and are case-sensitive, so use the exact label RT shows; when in doubt pass a number. RT does not reject a label it does not recognize, and does not reject a label at all on an installation with priority labels turned off: it sets the priority to 0, the lowest, and reports success. The response names the change RT made ("Priority changed from X to Y"), so check that the label it landed on is the one you asked for and tell the user if it is not.',
        },
        Owner: { type: 'string', description: 'New owner username' },
        Queue: { type: 'string', description: 'Move to this queue' },
        CustomFields: {
          type: 'object',
          description: 'Custom field values to update, as {CF_name: value}. Each value replaces everything the field currently holds, so for a multi-value field pass an array of the complete set you want ({"Tags": ["Red", "Blue"]}) — to add to existing values, read them with get_ticket first and include them. RT silently ignores names it does not recognize, so a success response does not confirm a field was set. Use get_queue_fields to see the custom fields available on the ticket\'s queue and to check a field\'s ContentFormat before writing a multi-line or formatted value.',
        },
        CustomRoles: { type: 'object', description: 'Custom role assignments as {role_name: username_or_array}' },
        Requestor: { description: 'Requestor username(s) — replaces existing list (string or array of strings)' },
        Cc: { description: 'Cc username(s) — replaces existing list (string or array of strings)' },
        AdminCc: { description: 'AdminCc username(s) — replaces existing list (string or array of strings)' },
        Due: { type: 'string', description: 'Due datetime (format: "YYYY-MM-DD HH:MM:SS" in local time)' },
        Starts: { type: 'string', description: 'Starts datetime (format: "YYYY-MM-DD HH:MM:SS" in local time)' },
        Started: { type: 'string', description: 'Started datetime (format: "YYYY-MM-DD HH:MM:SS" in local time)' },
        Told: { type: 'string', description: 'Last Contact datetime, labeled "Told" in RT (format: "YYYY-MM-DD HH:MM:SS" in local time)' },
        // Links are incremental only. RT also accepts a bare relation name, but
        // that replaces every existing link of the type, so it is refused here.
        AddRefersTo: { description: 'Add RefersTo links, keeping existing ones. One ticket ID, an array of IDs, or an external URI.' },
        AddReferredToBy: { description: 'Add ReferredToBy links, keeping existing ones. One ticket ID, an array of IDs, or an external URI.' },
        AddDependsOn: { description: 'Add DependsOn links, keeping existing ones. One ticket ID, an array of IDs, or an external URI.' },
        AddDependedOnBy: { description: 'Add DependedOnBy links, keeping existing ones. One ticket ID, an array of IDs, or an external URI.' },
        AddParent: { description: 'Add Parent links, keeping existing ones. One ticket ID, an array of IDs, or an external URI.' },
        AddChild: { description: 'Add Child links, keeping existing ones. One ticket ID, an array of IDs, or an external URI.' },
        DeleteRefersTo: { description: 'Remove specific RefersTo links. One ticket ID, an array of IDs, or an external URI. To replace a link, delete the old one and add the new one.' },
        DeleteReferredToBy: { description: 'Remove specific ReferredToBy links. One ticket ID, an array of IDs, or an external URI.' },
        DeleteDependsOn: { description: 'Remove specific DependsOn links. One ticket ID, an array of IDs, or an external URI.' },
        DeleteDependedOnBy: { description: 'Remove specific DependedOnBy links. One ticket ID, an array of IDs, or an external URI.' },
        DeleteParent: { description: 'Remove specific Parent links. One ticket ID, an array of IDs, or an external URI.' },
        DeleteChild: { description: 'Remove specific Child links. One ticket ID, an array of IDs, or an external URI.' },
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
        CustomFields: {
          type: 'object',
          description: 'Ticket custom field values to set while adding this comment, as {CF_name: value}. Each value replaces everything the field currently holds, so for a multi-value field pass an array of the complete set you want ({"Tags": ["Red", "Blue"]}) — to add to existing values, read them with get_ticket first and include them. RT silently ignores names it does not recognize, including transaction custom fields (not supported here), so a success response does not confirm a field was set. Use get_queue_fields to see the custom fields available on the ticket\'s queue.',
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
        CustomFields: {
          type: 'object',
          description: 'Ticket custom field values to set while sending this reply, as {CF_name: value}. Each value replaces everything the field currently holds, so for a multi-value field pass an array of the complete set you want ({"Tags": ["Red", "Blue"]}) — to add to existing values, read them with get_ticket first and include them. RT silently ignores names it does not recognize, including transaction custom fields (not supported here), so a success response does not confirm a field was set. Use get_queue_fields to see the custom fields available on the ticket\'s queue.',
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
        SLADisabled:       { type: 'boolean', description: 'Disable SLA for this queue. RT defaults this to true (SLA off) when omitted, so pass false explicitly to enable SLA on the new queue.' },
      },
      required: ['Name'],
    },
  },
  {
    name: 'update_queue',
    description:
      "Update an existing queue's settings (name, description, lifecycle, " +
      'email addresses, etc.). To manage watchers (Cc, AdminCc), use manage_queue_watchers instead. ' +
      'Each field is applied independently and the call succeeds even when some of them fail, ' +
      'so check the returned messages for every change you asked for — see PARTIAL UPDATES.',
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
      'To add a group by name, prefix it with "group:" (e.g. "group:Facilities Managers"); ' +
      'a bare name is looked up as a user and fails. Only user-defined groups resolve this ' +
      'way — not system groups like Everyone, and not role groups. ' +
      'Single-value custom roles (like Owner) cannot have queue-level members. ' +
      'A member that cannot be resolved is skipped and reported in the returned messages ' +
      'while the call still succeeds, so confirm every member you passed was actually ' +
      'added — see PARTIAL UPDATES.',
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
    description: 'Get details about a specific group by numeric ID',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Numeric group ID (RT has no name route for groups)' },
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
        id:          { type: 'string', description: 'Numeric group ID (RT has no name route for groups)' },
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
        id:      { type: 'string', description: 'Numeric group ID (RT has no name route for groups)' },
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
        id:        { type: 'string', description: 'Numeric group ID (RT has no name route for groups)' },
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
      'This REPLACES the stored configuration — any key you omit is dropped, including keys ' +
      'inherited from a create_lifecycle Clone. RT backfills defaults.on_create and falls back to ' +
      'ModifyTicket/DeleteTicket for missing rights, but omitted actions, colors, status_metadata ' +
      'and transition_metadata are simply lost. Cloning "default" inherits a full set of metadata, ' +
      'so omitting those two keys here silently strips the descriptions from every status. ' +
      'Use get_lifecycle first to get the current config, then modify and send the whole thing back. ' +
      'The lifecycle is validated before saving; any warning fails the update with a 400.',
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
        actions: {
          description:
            'UI action buttons for transitions, keyed by transition: ' +
            '{"new -> open": {"label": "Open It", "update": "Respond"}}. ' +
            'RT also accepts its native flat array alternating transition string and info object ' +
            '(["new -> open", {"label": "Open It"}]), which is what get_lifecycle returns for ' +
            'lifecycles cloned from default — send that form back unchanged if you are not editing it. ' +
            'An array of {from, to, label} objects is REJECTED with a 400. ' +
            '"label" is the button text; "update" is optional and opens that form when clicked ' +
            '("Respond" or "Comment"). Wildcards are allowed, e.g. "* -> resolved". ' +
            'The keyed form is ordered by sorted transition string; the array form keeps the order given.',
        },
        colors:     { type: 'object', description: 'Status colors as {"status_name": "#hex_color"}. Colors appear in the RT web UI next to status names.' },
        status_metadata: {
          type: 'object',
          description:
            'Per-status documentation, keyed by status name: ' +
            '{"stalled": {"description": "Blocked, waiting on something external.", ' +
            '"notes": "Note what you are waiting on."}}. ' +
            '"description" is human-facing, "notes" is guidance for an AI agent working the ticket. ' +
            'Both are optional free text; no other fields are allowed.',
        },
        transition_metadata: {
          type: 'object',
          description:
            'Per-transition documentation, keyed like rights: ' +
            '{"open -> resolved": {"description": "The work is complete.", ' +
            '"notes": "Resolve when the work is verified."}}. ' +
            'Same two optional fields as status_metadata. Wildcards are allowed ' +
            '("* -> rejected"), and unlike rights, matching entries merge field by field ' +
            'with the more specific key winning.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'validate_lifecycle',
    description:
      'Check a lifecycle definition without saving it. Takes the same payload as ' +
      'update_lifecycle and reports whether RT would accept it, with a warning for each ' +
      'problem found (unknown statuses, malformed transitions or actions, and so on). ' +
      'Use this to dry-run a custom lifecycle before writing it, since update_lifecycle ' +
      'rejects the whole payload if anything is wrong. The lifecycle does not have to exist ' +
      'yet, so a definition can be checked before create_lifecycle.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        name:        { type: 'string', description: 'Lifecycle name to validate against; need not exist yet' },
        initial:     { type: 'array', items: { type: 'string' }, description: 'Initial statuses' },
        active:      { type: 'array', items: { type: 'string' }, description: 'Active statuses' },
        inactive:    { type: 'array', items: { type: 'string' }, description: 'Inactive statuses' },
        defaults:    { type: 'object', description: 'Default statuses (e.g. {on_create: "new"})' },
        transitions: { type: 'object', description: 'Allowed transitions as {from_status: [to_statuses]}' },
        rights:      { type: 'object', description: 'Rights required for transitions as {"from -> to": "RightName"}' },
        actions:     { description: 'UI action buttons — see update_lifecycle for the accepted formats' },
        colors:      { type: 'object', description: 'Status colors as {"status_name": "#hex_color"}' },
        status_metadata:     { type: 'object', description: 'Per-status description/notes — see update_lifecycle' },
        transition_metadata: { type: 'object', description: 'Per-transition description/notes — see update_lifecycle' },
      },
      required: ['name'],
    },
  },
  {
    name: 'delete_lifecycle',
    description:
      'Delete a lifecycle. Fails if any queue or catalog still uses it — reassign those ' +
      'to another lifecycle first (get_lifecycle reports them under used_by). ' +
      'Useful for cleaning up a lifecycle created by mistake.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Lifecycle name to delete' },
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
        object_id: { type: 'string', description: 'Object ID, or name for a queue, class or catalog (group and customfield are numeric id only). Not needed for global.' },
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
        object_id: { type: 'string', description: 'Object ID, or name for a queue, class or catalog (group and customfield are numeric id only). Not needed for global.' },
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
        object_id: { type: 'string', description: 'Object ID, or name for a queue, class or catalog (group and customfield are numeric id only). Not needed for global.' },
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
        object_id: { type: 'string', description: 'Object ID, or name for a queue, class or catalog (group and customfield are numeric id only). Not needed for global.' },
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
        Type:       { type: 'string', description: 'Filter by the stored base type — Select, Freeform, Text, HTML and so on. Not the composite name create_custom_field takes: SelectSingle matches nothing.' },
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
];

export type Args = Record<string, unknown>;

export async function callTool(rt: RTClient, name: string, args: Args): Promise<unknown> {
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
        fields: args.fields as string | undefined,
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
      return readFileSync(dataFile('ticketsql_grammar.md'), 'utf8');

    case 'get_current_user':
      return rt.getCurrentUser();

    case 'lookup_user':
      return rt.lookupUser(args.query as string, {
        per_page: args.per_page as number | undefined,
        page: args.page as number | undefined,
        fields: args.fields as string | undefined,
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
        // Clients that fill optional params with an explicit null would otherwise
        // send "CustomFields": null; only undefined is dropped by JSON.stringify.
        CustomFields: (args.CustomFields ?? undefined) as Record<string, unknown> | undefined,
        Attachments: args.Attachments as AttachmentInput[] | undefined,
      });

    case 'add_reply':
      return rt.ticketCorrespond(args.id as number, {
        Content: args.Content as string | undefined,
        ContentType: args.ContentType as 'text/plain' | 'text/html' | undefined,
        TimeTaken: args.TimeTaken as number | undefined,
        Status: args.Status as string | undefined,
        CustomFields: (args.CustomFields ?? undefined) as Record<string, unknown> | undefined,
        Attachments: args.Attachments as AttachmentInput[] | undefined,
      });

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

    case 'validate_lifecycle': {
      const { name, ...config } = args;
      return rt.validateLifecycle(name as string, config);
    }

    case 'delete_lifecycle':
      return rt.deleteLifecycle(args.name as string);

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

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
