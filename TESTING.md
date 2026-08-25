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

**Prompt:** (on a ticket whose multi-value `[CF name]` already holds `[existing value]`)
`Add [new value] to the [CF name] custom field on ticket [ID]`

**Expected:** The existing value survives. RT replaces the whole value set for a multi-value
custom field, so the AI must read the current values first and send both
(`{"Test Tags": ["Red", "Blue"]}`), not just the new one.

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
- Searches `Type = 'reminder' AND Owner = 'your-username' AND Status = '__Active__'`
- **Not** `Status = 'open'`. This server creates reminders through the ticket API, so they
  start in the queue lifecycle's `on_create` status — `new` in RT's default lifecycle —
  while a reminder created from the ticket's Reminders box in the web UI starts in that
  lifecycle's `reminder_on_open` status, `open` by default. Confirm the reminder you just
  created in section 6 actually appears.

Create a second reminder on the same ticket from the web UI and search again. Both should
come back, in different statuses. That is the case no literal status name can cover.

This is also worth running on more than one lifecycle if you have them. RT's default
lifecycle uses `on_create => 'new'`, while RTIR's `incidents` lifecycle uses
`on_create => 'open'` — so `Status = 'open'` silently works on RTIR and fails on stock RT.

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

**Prompt:** `Add a comment to ticket [ID] saying "Investigated" and set the [CF name] custom field to [value]`

**Expected:** A single `add_comment` call carrying both `Content` and `CustomFields` — not a
separate `update_ticket` call afterwards. RT still records the custom field changes as their own
`CustomField` transactions following the `Comment` transaction; the point is that one tool call
does both. Multi-value fields take an array (`{"Test Tags": ["Red", "Blue"]}`). Works the same
way with `add_reply`.

**Prompt:** (on a ticket whose multi-value `[CF name]` already holds `[existing value]`)
`Add a comment to ticket [ID] and also tag it [new value]`

**Expected:** The existing value survives. RT replaces the whole value set for a multi-value
custom field, so the AI must read the current values first and send both
(`{"Test Tags": ["Red", "Blue"]}`), not just the new one. If `[existing value]` is gone
afterwards, the `CustomFields` tool description is not steering the AI correctly.

**Prompt:** `Add a comment to ticket [ID] and set the [misspelled CF name] custom field to [value]`

**Expected:** RT ignores custom field names it does not recognize and still returns success, so
the tool call succeeds with nothing set. The AI should not claim the field was set — the
description warns that a success response does not confirm it.

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

**Prompt:** `What custom fields does the [queue name] queue have?`

**Expected:**
- Every custom field applied to the queue is listed, with type and allowed values
- All three groups are reported and distinguished: `CustomFields` (set on tickets),
  `QueueCustomFields` (set on the queue itself, with `CurrentValues`), and
  `TransactionCustomFields` (set on comments and replies)

On an RTIR instance, ask the same question about the `Incidents` queue. `RTIR Constituency`
and `RTIR default WHOIS server` must both appear under `QueueCustomFields` — they are applied
to the queue object, not to tickets, and were previously reported as missing.

---

## 12. HTML and Plain Text Fields

Needs a queue with at least one `HTML` custom field and one `Text` custom field.

**Prompt:** `What custom fields does [queue] have, and which take HTML?`

**Expected:** The AI reports each field's `ContentFormat` — `html`, `plain-text-multiline`,
`plain-text`, `wikitext`, `file`, `date` or `datetime` — rather than only RT's type names.

**Prompt:** `Set the description on ticket [ID] to a two-paragraph summary of the problem`

**Expected:** The description renders in RT as separate paragraphs, not one run-on block.
The AI may send HTML itself, or send plain text with blank lines and let the server convert
it. Check the rendered ticket, not just the stored value.

**Prompt:** `Put a two-line note in the [HTML custom field] on ticket [ID]`

**Expected:** Line breaks appear in RT. An `html` field needs `<br />` or `<p>`; if the AI
sends bare newlines the value renders as one line — that is the failure this section is
looking for, and the AI should have used the `ContentFormat` hint to avoid it.

**Prompt:** `Put "profit margin > 50% & rising" in the [HTML custom field] on ticket [ID]`

**Expected:** The text displays exactly as written. RT escapes a bare `>` and `&` itself, so
the AI should not pre-escape them and the value must not show as `&gt;` or `&amp;` on screen.

Angle brackets that look like a tag are the exception: RT deletes any tag it does not allow
along with the text inside it, so those have to be escaped before they reach RT.

**Prompt:** `Note in the [HTML custom field] on ticket [ID] that the contact is <ops@example.com>`

**Expected:** The address is visible in RT. The failure this is looking for is a value that
renders as "the contact is" with the address gone — RT parsed `<ops@example.com>` as a tag
and dropped it. The AI should have sent `&lt;ops@example.com&gt;`.

**Prompt:** `Set the description on ticket [ID] to two lines: "Disk usage < 10% free" and
"Please investigate today"`

**Expected:** Both lines are visible and on separate lines. Two failures to watch for: the
`<` swallowing the rest of the line, and the line break rendering as nothing because the
value skipped paragraph conversion. A bare `<` in prose is not markup.

---

## 13. Queue Custom Fields Under Restricted Rights

This covers the failure mode where a queue appeared to have no custom fields at all.
It needs a second RT user whose `SeeCustomField` right is granted **on the queue**
rather than globally, plus an auth token for that user:

- Grant that user `SeeQueue`, `ShowTicket`, and `SeeCustomField` on one queue only
- Do not grant `SeeCustomField` globally, and do not make the user a SuperUser
- Point a second MCP server entry at that user's token

**Prompt:** `What custom fields does the [queue name] queue have?`

**Expected:**
- Every custom field applied to the queue is still listed by name — the count must match
  what RT shows under Admin > Queues > Custom Fields
- Fields whose details cannot be read carry a `DetailsUnavailable` message
- The AI reports those fields as present but unreadable, **not** as missing, and does not
  claim the queue has no custom fields
