# mcp-server-rt

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that connects AI assistants to a live [RT (Request Tracker)](https://bestpractical.com/request-tracker) instance. Search tickets, view history, create and update tickets — all from a natural language conversation.

## Requirements

- RT 6.0 or later with REST 2.0 API enabled (included by default)
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

---

## AI Client Setup

MCP is an open standard — this server works with any MCP-compatible AI client. Configuration varies by client.

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

### Claude Desktop ✓ (tested)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

| Tool | Description |
|------|-------------|
| `search_tickets` | Search tickets using RT's TicketSQL query language |
| `get_ticket` | Get details for a specific ticket by ID |
| `get_ticket_history` | Get transaction history (comments, replies, status changes) |
| `get_queue` | Get details about a queue by ID or name |
| `list_queues` | List all available queues |
| `lookup_user` | Search for RT users by name or email |
| `get_queue_fields` | Get custom field definitions and lifecycle name for a queue |
| `get_ticketsql_grammar` | Fetch the full TicketSQL grammar reference (for complex queries) |
| `create_ticket` | Create a new ticket |
| `update_ticket` | Update ticket fields (status, owner, priority, custom fields, etc.) |
| `add_comment` | Add an internal comment (not visible to the requestor) |
| `add_reply` | Send a reply to the requestor |

## Example Conversations

- "Show me open tickets in the General queue assigned to nobody"
- "What tickets did root@localhost open in the last 30 days?"
- "Add a comment to ticket 42 saying the issue is under investigation"
- "Resolve ticket 15 and reply to the requestor that it's been fixed"
- "What custom fields does the General queue have?"
- "Find all tickets with the Category custom field set to 'Bug'"

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

## License

Artistic License 2.0
