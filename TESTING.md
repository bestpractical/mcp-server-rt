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
- Results show Subject, Status, Queue, Owner, Requestor, Priority, LastUpdated and Due (omitting blanks)
- Queue and Owner read as names, not object stubs like `{"id": 1, "type": "queue"}`
- Each ticket is displayed on one or two lines (not a bare list of IDs)
- Ticket IDs link to the RT web UI (`/Ticket/Display.html?id=...`), not the REST API

The server sends that field set itself, so the results should be the same whether or not the tool
call carries a `fields` parameter. A call with no `fields` at all is the case worth watching: it is
what used to come back as bare IDs.

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
- `Owner` may be dropped from the display, since every row is yours and the column repeats the
  question back
- `Requestor` may be dropped too, since a task list is about what to do next rather than who asked

A narrowed set replaces the default rather than subtracting from it, so a call that drops a field
has to list every other field it still wants. Watch for one that passes a short `fields` and loses
Subject or Status along with it.

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
- `Priority` may be sent as the label `High` or as a number; both work on update

**Prompt:** `Create a ticket in [queue] with subject "Priority label test" and priority High`

**Expected:**
- `create_ticket` is called with `Priority: "High"`, and the ticket ends up at the number
  the queue's `PriorityAsString` mapping assigns to `High` (100 with RT's default mapping)
- RT cannot resolve a label during create, so the server applies it in a follow-up update.
  The ticket history therefore shows a priority change immediately after creation — that is
  expected, not a bug
- The response carries `PrioritySet` with the change RT reported, naming the label it landed
  on (`Priority changed from 'Low' to 'High'`)
- If the follow-up fails outright, the response carries `PriorityNotSet` instead and the AI
  should say the ticket was created but the priority was not set

**Prompt:** `Create a ticket in [queue] with priority Catastrophic` *(a label that does not exist)*

**Expected:** RT does not reject the label. `SetPriority` cannot find it in the queue's
mapping, falls back to 0 — the lowest priority — and reports success, so the ticket is
created at priority 0. The server cannot detect this: REST2 exposes neither the queue's
mapping nor a ticket's `PriorityAsString`, so there is nothing to validate against. What it
can do is pass RT's own report back, so `PrioritySet` should name the label 0 maps to
(`Low` with RT's default mapping) rather than `Catastrophic`, and the AI should notice the
mismatch and tell you the priority was not set to what you asked for. Note that `Low` is 0
in RT's default mapping, so an unrecognized label and a genuine `Low` are indistinguishable
by number alone — the label RT names is the signal.

The same is true on an RT with `$EnablePriorityAsString` off: every label resolves to 0.

**Prompt:** `Set the priority on ticket [ID] to Catastrophic`

**Expected:** Same coercion on the update path, and here RT's report is returned directly
rather than under `PrioritySet`. The AI should read `Priority changed from ... to 'Low'` and
tell you the label was not recognized instead of reporting the change as made.

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

**Expected:** Lists attachment names, types, and sizes — not a bare list of IDs. Note that an
email body part legitimately has an empty `Filename`; the `Subject` and `ContentType` should
still identify it.

**Prompt:** `Save the attachment [name] from ticket [ID] to my Desktop`

**Expected:** File written to the specified path.

---

## 11. Queue and User Lookup

**Prompt:** `What queues are available?`

**Expected:** Returns queue list with names.

**Prompt:** `Look up user [name or email]`

**Expected:** Returns matching accounts with real names and email addresses, not just usernames.

**Prompt:** `What has happened on ticket [ID]?`

**Expected:** The history is summarised from one `get_ticket_history` call — each entry showing
its type, the field changed, and the new value. The AI should not need a `get_transaction` call
per row just to learn what each entry was.

Owner, watcher and custom field changes are the entries to check. RT stores a numeric user ID in
`OldValue`/`NewValue` for `SetWatcher`, `AddWatcher` and `DelWatcher`, and for `CustomField` it
stores the field's numeric ID in `Field` with the values in `OldReference`/`NewReference`. The AI
should report those as an ID, or resolve the custom field name with `get_queue_fields` — what it
must not do is present a plausible username or field name it had no way to look up.

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

## 13. Ticket Links

Start with a ticket that already has at least one `RefersTo` link.

**Prompt:** `Make ticket [A] refer to ticket [B] as well`

**Expected:** `update_ticket` with `AddRefersTo`. The existing link is still there
afterwards — adding a link must never remove one.

**Prompt:** `Make ticket [A] refer to tickets [B] and [C]`

**Expected:** A single `AddRefersTo` carrying an array, not one call per ticket.

**Prompt:** `Ticket [A] should no longer refer to ticket [B]`

**Expected:** `update_ticket` with `DeleteRefersTo`.

**Prompt:** `Replace ticket [A]'s references so it only refers to ticket [C]`

**Expected:** A `get_ticket` to read the links that are there, then a delete of those
followed by an add — or the AI asking which links to remove. It must name the links it
deletes rather than guessing at them. `update_ticket` does not accept a bare `RefersTo`;
if the AI tries one it gets an error naming `AddRefersTo`/`DeleteRefersTo` and **no links
change**. Verify in RT that nothing was unlinked by the rejected attempt.

Now give the ticket a child, and check the relation whose name changes between reading and
writing: a child link is reported in `get_ticket` under `ref` `child`, but it is removed
with `DeleteChild`.

**Prompt:** `What is ticket [A] linked to?`

**Expected:** The child is listed. The AI reads links from the `_hyperlinks` of the
`get_ticket` response — there is no separate links tool, so an answer of "no links" means
it did not look there.

**Prompt:** `Ticket [A] should no longer have that child`

**Expected:** `DeleteChild` with the child's ticket ID. Not `DeleteMemberOf`, not a bare
`Child`, and not a delete aimed at the parent instead.

Repeat one of these with `DependsOn` to confirm the other relations behave the same way.

---

## 14. Queue Custom Fields Under Restricted Rights

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
