# mcp-server-rt

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that connects AI assistants to a live [RT (Request Tracker)](https://bestpractical.com/request-tracker) instance. Search tickets, view history, create and update tickets — all from a natural language conversation.

## Features

- **Search tickets** using RT's full TicketSQL query language
- **Read ticket details** including full transaction history
- **Create tickets** setting initial content and all ticket metadata: status, owner, requestors, due dates, custom fields, custom roles, and links
- **Update tickets** reply, comment, and update tickets, with the same full field support
- **Queue and user discovery** — list queues, inspect custom field definitions, look up users by name or email
- **TicketSQL grammar reference** — the AI can consult the full RT 6.0.3 syntax guide before constructing complex queries
- **Queue administration** — build and configure queues: lifecycles, user-defined groups and their
  members, custom fields, rights, and queue watchers
- **Guided queue creation** — a `create-queue` prompt that interviews you about the workflow,
  recommends a configuration, confirms the plan, then builds it

## Requirements

- RT 6.0 or later with REST 2.0 API enabled (included by default). The lifecycle and
  rights tools need RT 6.0.3 or later, which is when RT added those REST 2.0 endpoints.
- Node.js 18 or later
- An RT authentication token

## Installation

```bash
npm install -g mcp-server-rt
```

Or use without installing via `npx mcp-server-rt`.

### Creating an RT Auth Token

In RT: **Logged in as → Settings → Auth Tokens → Create**

Give the token a name (e.g. "Claude") and copy the generated token string.

The token is associated with the user account, so all operations in RT from Claude using that token will be logged as performed by that user. So everything you do via Claude still gets logged in RT as you, including emails sent on comments and replies.

Users need to be granted the right ManageAuthTokens to see the Auth Tokens menu.

---

## AI Client Setup

MCP is an open standard — this server works with any MCP-compatible AI client. Configuration varies by client.

### Claude Desktop ✓ (tested)

Install the `.mcpb` extension package from the [releases page](https://github.com/bestpractical/mcp-server-rt/releases). In the Claude app, go to **Customize → Connectors**, find RT, and enter your RT URL and auth token.

Alternatively, add manually to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "rt": {
      "type": "stdio",
      "command": "npx",
      "args": ["mcp-server-rt"],
      "env": {
        "RT_URL": "https://rt.example.com",
        "RT_TOKEN": "your-auth-token"
      }
    }
  }
}
```

### Claude Code ✓ (tested)

Add to `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "rt": {
      "type": "stdio",
      "command": "npx",
      "args": ["mcp-server-rt"],
      "env": {
        "RT_URL": "https://rt.example.com",
        "RT_TOKEN": "your-auth-token"
      }
    }
  }
}
```

### Other MCP-compatible clients

Any client that supports MCP stdio servers should work. Consult your client's documentation for how to register a stdio MCP server with environment variables. The server entry point is `mcp-server-rt` (or `node /path/to/dist/index.js` for a local build).

---

## Tools

### Tickets, queues, and users

| Tool | Description |
|------|-------------|
| `search_tickets` | Search tickets using RT's TicketSQL query language |
| `get_ticket` | Get details for a specific ticket by ID |
| `get_ticket_history` | Get transaction history (comments, replies, status changes) |
| `get_transaction` | Get full details of a single transaction, including decoded message content |
| `get_queue` | Get details about a queue by ID or name |
| `list_queues` | List all available queues |
| `get_queue_fields` | Get custom field definitions and lifecycle name for a queue |
| `lookup_user` | Search for RT users by name or email |
| `get_current_user` | Get the RT user associated with the configured auth token |
| `get_ticketsql_grammar` | Fetch the full TicketSQL grammar reference (for complex queries) |
| `create_ticket` | Create a new ticket |
| `update_ticket` | Update ticket fields (status, owner, priority, dates, watchers, links, custom fields) |
| `add_comment` | Add an internal comment (not visible to the requestor), optionally setting custom fields |
| `add_reply` | Send a reply to the requestor, optionally setting custom fields |
| `get_ticket_attachments` | List all attachments on a ticket |
| `get_attachment` | Retrieve a single attachment by ID |
| `save_attachment` | Save an attachment to a local file |

### Queue administration

Building and configuring queues. The lifecycle and rights tools need RT 6.0.3 or later.

| Tool | Description |
|------|-------------|
| `create_queue` | Create a new queue |
| `update_queue` | Update an existing queue's settings |
| `manage_queue_watchers` | Set the members of a queue role (Cc, AdminCc, or a custom role) |
| `list_groups` | List user-defined groups with names and descriptions |
| `get_group` | Get details about a group by ID or name |
| `create_group` | Create a new user-defined group |
| `list_group_members` | List a group's members (RT returns IDs and types only) |
| `add_group_members` | Add users to a group, by user ID |
| `remove_group_member` | Remove a user from a group |
| `create_custom_field` | Create a custom field |
| `search_custom_fields` | Search existing custom fields before creating a duplicate |
| `apply_custom_field` | Apply a custom field to a queue |
| `add_custom_field_value` | Add a selectable value to a custom field |
| `list_custom_field_applications` | List the objects a custom field is applied to |
| `remove_custom_field_application` | Stop applying a custom field to an object |
| `list_lifecycles` | List lifecycles with their statuses and transitions |
| `get_lifecycle` | Get one lifecycle's full definition |
| `create_lifecycle` | Create a lifecycle, optionally cloning an existing one |
| `update_lifecycle` | Replace a lifecycle's configuration |
| `update_lifecycle_maps` | Map this lifecycle's statuses onto other lifecycles |
| `validate_lifecycle` | Check a lifecycle definition without saving it |
| `delete_lifecycle` | Delete a lifecycle no queue or catalog uses |
| `get_available_rights` | List the rights that can be granted on an object |
| `list_rights` | List the rights currently granted on an object |
| `grant_rights` | Grant rights to a user, group, or role |
| `revoke_right` | Revoke a single right |

## Prompts

| Prompt | Description |
|--------|-------------|
| `create-queue` | Interactive consultant that discovers a team's workflow, recommends a queue configuration, confirms the plan, then builds it — queue, lifecycle, groups, rights, custom fields, and watchers |

---

## Usage Examples

### Example 1: Finding and triaging unowned tickets

**User:** "Show me active tickets in the Support queue with no owner."

**Claude calls:** `search_tickets` with query `Queue = 'Support' AND Status = '__Active__' AND Owner = 'Nobody'`. No `fields` parameter is needed — the server sends a default set that identifies each ticket, with queue and owner as names rather than ID stubs.

**Result:** A table of unowned active tickets with subject, requestor, and when each was last updated, ready to assign or act on.

---

### Example 2: Reading recent correspondence on a ticket

**User:** "Show me the most recent reply on ticket 1234."

**Claude calls:** `get_ticket_history` to get the list of transactions, identifies the most recent `Correspond` entry, then calls `get_transaction` to fetch and decode the full message content.

**Result:** The decoded text of the reply, including who sent it and when.

---

### Example 3: Creating a fully configured ticket

**User:** "Create a ticket in the Projects queue titled 'Update onboarding docs', assign it to alice, set the due date to next Friday, and link it to ticket 500."

**Claude calls:** `create_ticket` with Queue, Subject, Owner, Due, and RefersTo all set in a single API call.

**Result:** New ticket created with all fields set. Claude confirms the ticket number and a summary of what was set.

---

### Example 4: Updating ticket status with a reply

**User:** "Resolve ticket 789 and let the requestor know we've pushed a fix in version 6.0.3."

**Claude calls:** `add_reply` with the message content and `Status: 'resolved'` to close the ticket and notify the requestor in one step.

**Result:** Ticket resolved, requestor notified. Claude confirms both actions completed.

---

### Example 5: Querying with custom fields

**User:** "Find all open tickets in the General queue where the Category field is set to 'Bug'."

**Claude calls:** `get_queue_fields` to confirm the exact custom field name, then `search_tickets` with `Queue = 'General' AND Status = '__Active__' AND CF.{Category} = 'Bug'`.

**Result:** A list of matching bug tickets with subject, owner, and creation date.

---

## How It Works

This server implements the [Model Context Protocol](https://modelcontextprotocol.io/) over stdio. The AI client translates natural language requests into TicketSQL queries or RT API calls, invokes the appropriate tool, and presents the results. The server itself is a thin proxy — it passes queries directly to RT's REST 2.0 API and returns the JSON response.

For complex searches, the AI can call `get_ticketsql_grammar` to consult the full TicketSQL syntax reference before constructing a query.

## Configuration Reference

| Environment Variable | Description |
|----------------------|-------------|
| `RT_URL` | Base URL of your RT instance (e.g. `https://rt.example.com`) |
| `RT_TOKEN` | RT authentication token |

## Development

```bash
npm install
npm run build     # compile TypeScript to dist/
npm test          # run tests
npm run dev       # watch mode
```

Run locally against your RT instance:

```bash
RT_URL=https://rt.example.com RT_TOKEN=your-token node dist/index.js
```

## Compatibility

- RT 6.0+ (REST 2.0 API)
- Node.js 18+

## Privacy

This server does not collect, store, or transmit any data to Best Practical or any third party. All communication is directly between your AI client and your own RT instance using the URL and credentials you provide. No usage data, ticket content, or credentials are sent anywhere other than your configured RT server.

See the [Best Practical Privacy Policy](https://requesttracker.com/privacy-policy/) for general information about our privacy practices.

## Support

For questions and discussion, visit the [Best Practical Community Forum](https://forum.bestpractical.com).

To report a bug, create a ticket on our [public RT instance](https://rt.bestpractical.com). Note that this is a public RT instance, so the information you share will be visible to others.

Is RT mission critical for you? Commercial support for RT and this connector is available from Best Practical. Contact us at [sales@bestpractical.com](mailto:sales@bestpractical.com).

## License

GPL-2.0
