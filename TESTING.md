# Live Test Plan

These tests require a running RT instance and a configured MCP connection. Run them in an AI assistant (e.g. Claude Desktop or Claude Code) with the `rt` MCP server active.

## Prerequisites

- RT instance running and accessible
- `RT_URL` and `RT_TOKEN` set in your MCP configuration
- At least one queue with tickets exists
- Note your username (ask: "who am I in RT?")

---

## 1. Basic Connectivity

**Prompt:** `Who am I in RT?`

**Expected:** Returns your RT username and account details.

---

## 2. Ticket Search — Default Field Set

**Prompt:** `Show me the last 5 tickets`

**Expected:**
- Calls `search_tickets` with `fields=Subject,Status,Queue,Owner,Requestor,Priority,LastUpdated,Due`
- Includes `subfields={"Queue":"Name","Owner":"Name"}` so Queue and Owner display as human-readable names
- Results show all those fields (omitting blanks)
- Each ticket is displayed on one or two lines (not a bare list of IDs)
- Ticket IDs link to the RT web UI (`/Ticket/Display.html?id=...`), not the REST API

---

## 3. TicketSQL — Status Meta-Values

**Prompt:** `Show me all active tickets`

**Expected:**
- Query uses `Status = '__Active__'`, not `Status = 'open'` or `Status = 'active'`
- The AI consults `get_ticketsql_grammar` before constructing the query (visible in tool calls)

**Prompt:** `Show me resolved tickets in the last month`

**Expected:**
- Uses `Status = '__Inactive__'` or `Status = 'resolved'` as appropriate
- Date condition uses valid TicketSQL syntax (e.g. `LastUpdated > '1 month ago'`)

---

## 4. Ticket Search — Context-Sensitive Fields

**Prompt:** `Show me tickets assigned to me`

**Expected:**
- Calls `get_current_user` to resolve "me"
- Uses `Owner = 'your-username'` in the query
- `Requestor` field may be dropped since this is a personal task view

**Prompt:** `Show me open support tickets and who requested them`

**Expected:**
- `Requestor` field is included in results

---

## 5. Create and Update a Ticket

**Prompt:** `Create a test ticket in [queue name] with subject "MCP live test"`

**Expected:** Ticket is created and a link to the web UI is returned.

**Prompt:** `Set the priority to high and due date to next Friday`

**Expected:**
- `update_ticket` called with correct `Priority` and `Due` values
- Due date is in the correct local timezone (verify in RT that it shows the right date)

**Prompt:** `Resolve it`

**Expected:** Status updated to `resolved`.

---

## 6. Reminders — Create

**Prompt:** `Set a reminder on ticket [ID] to follow up`

**Expected:**
- Calls `get_current_user` to get your username
- Calls `create_ticket` with `Type = 'reminder'`, `Owner = your-username`, `RefersTo = [ID]`
- Reminder appears on the ticket in the RT web UI

**Prompt:** `Set a reminder` *(no ticket context)*

**Expected:** AI asks which ticket to link the reminder to before creating.

---

## 7. Reminders — Search

**Prompt:** `What reminders do I have on ticket [ID]?`

**Expected:**
- Searches `Type = 'reminder' AND RefersTo = '[ID]' AND Owner = 'your-username'`
- Returns the reminder(s) with subject and status

**Prompt:** `Show me all my open reminders`

**Expected:**
- Searches `Type = 'reminder' AND Owner = 'your-username' AND Status = 'open'` (or `__Active__`)

---

## 8. Reminders — Close

**Prompt:** `Mark the reminder on ticket [ID] as done`

**Expected:**
- Searches for active reminders on that ticket owned by current user
- If exactly one found: updates status to `resolved` (or the configured inactive status)
- If multiple found: asks which one to close
- Confirm in RT web UI that the reminder no longer appears as active

---

## 9. Comments and Replies

**Prompt:** `Add an internal comment to ticket [ID]: "Tested via MCP"`

**Expected:** `add_comment` called; comment appears in ticket history in RT.

**Prompt:** `Reply to ticket [ID] and say the issue has been resolved`

**Expected:** `add_reply` called; reply visible to requestor in RT.

---

## 10. Attachments

**Prompt:** `What attachments are on ticket [ID]?`

**Expected:** Lists attachment names, types, and sizes.

**Prompt:** `Save the attachment [name] from ticket [ID] to my Desktop`

**Expected:** File written to the specified path.

---

## 11. Queue and User Lookup

**Prompt:** `What queues are available?`

**Expected:** Returns queue list with names.

**Prompt:** `Look up user [name or email]`

**Expected:** Returns matching RT user accounts.
