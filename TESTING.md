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

---

## Automated Prompt Testing with Dual Agents

This section describes how to test MCP prompts (like `/mcp__rt__create-queue`) end-to-end using two Claude Code sub-agents: one playing the AI consultant role and one playing the end user. The orchestrating session relays messages between them.

### Overview

The test exercises the full prompt workflow — discovery conversation, plan presentation, user approval, and execution against a live RT instance — without a human in the loop. After execution, you verify the created objects in RT and then clean them up.

### Prerequisites

- RT dev instance running and accessible
- `rt` MCP server built (`npm run build`) and configured in `~/.claude.json`
- Claude Code session with access to MCP tools
- The `rt-shredder` command available for cleanup (`sbin/rt-shredder` in the RT checkout)

### Architecture

```
┌──────────────────┐     relay      ┌──────────────────┐
│   AI Consultant  │ <──messages──> │   End User Agent  │
│   (Agent #1)     │                │   (Agent #2)      │
│                  │                │                    │
│  Has: create-    │                │  Has: persona      │
│  queue prompt    │                │  prompt with       │
│  instructions,   │                │  scenario details, │
│  MCP tool access │                │  behavioral rules  │
└──────────────────┘                └──────────────────┘
         │                                    │
         │  Orchestrated by the main Claude Code session
         │  which relays responses between agents
         └────────────────────────────────────┘
```

The main session:
1. Launches the AI consultant agent with the create-queue prompt instructions
2. Launches the end user agent with a persona prompt
3. Takes the consultant's output, sends it to the end user agent
4. Takes the end user's response, sends it back to the consultant
5. Repeats until the consultant has enough info to present a plan
6. After user approval, launches the consultant with execution instructions and MCP tool access
7. Verifies the results in RT
8. Cleans up with `rt-shredder`

### Step 1: Create the AI Consultant Agent

Launch with the Agent tool. The prompt should include:

- The consultant role (workflow consultant, opinionated, leads with questions)
- Key behavioral rules from the create-queue prompt (one question at a time, discover before recommending)
- Execution guidelines (bulk CF values, group names for rights, group nesting, ask about watchers, ask about group members)
- The numbered execution steps (check lifecycles, create queue, groups, rights, CFs, watchers, summarize)
- Instruction to start with ONE open-ended question

Example opening:

```
Now start. Send your opening question to the admin. Keep it to ONE open-ended question.
```

### Step 2: Create the End User Agent

Launch with the Agent tool. The prompt should include:

- A character description (role, organization, years of experience, technical level)
- The department's reality as a set of facts to reveal naturally (work types, team structure, how work arrives, pain points, preferences)
- Behavioral rules:
  - Answer naturally, 3-5 sentences per turn
  - Don't dump everything at once — answer what's asked, add one related detail
  - Improvise consistent details (names, examples)
  - Push back if something doesn't fit the character
  - Approve plans with minor feedback when appropriate

**Important framing note:** If the end user agent refuses to role-play, reframe the task as "generating realistic test input to exercise the queue creation system." This is a software testing task, not creative fiction.

### Step 3: Run the Discovery Conversation

Relay messages between agents for 4-6 turns. A typical conversation:

| Turn | Consultant asks about | User reveals |
|------|----------------------|--------------|
| 1 | What work does the queue manage? | Big picture: work types, basic flow |
| 2 | How is work assigned? Where does it get stuck? | Team structure, pain points |
| 3 | Who submits? How does work arrive? | Requesters, channels (email/portal/phone) |
| 4 | Who needs notifications? | Watchers, email preferences |
| 5 | (Presents plan) | Reviews and approves with adjustments |

The consultant should naturally discover enough to form a recommendation. If it asks too many questions without converging, the prompt may need tuning.

### Step 4: Execute the Plan

After user approval, launch the consultant agent with:

- The full approved plan (revised per user feedback)
- Explicit execution instructions with object details (lifecycle statuses, CF values, group names, rights per principal)
- Reminder of technical guidelines (bulk Values array, group names for rights, actions format)
- Instruction to report a summary when done

This agent needs MCP tool access (default for general-purpose agents).

### Step 5: Verify Results

After execution, verify in the main session:

```
# Check rights were granted correctly (system groups, roles, user-defined groups)
mcp__rt__list_rights on the new queue with per_page=100

# Check lifecycle was created with correct statuses
mcp__rt__get_lifecycle for the new lifecycle name

# Check custom fields have correct values
# (visible in the execution agent's summary)
```

Key things to verify:
- **System groups by name**: Everyone, Privileged, Unprivileged appear with correct IDs
- **Role groups by name**: Requestor, Owner, Cc, AdminCc resolved correctly
- **Bulk CF values**: All values created in one tool call (not one per value)
- **Group nesting**: Supervisor/manager group nested inside staff group
- **Staff CreateTicket**: Staff group has CreateTicket right
- **Watchers set**: AdminCc and Cc configured on the queue
- **No DeleteTicket**: For compliance scenarios, verify no principal has DeleteTicket

### Step 6: Clean Up

Remove all created objects using `rt-shredder` and the REST API:

```bash
# Queue (cascades to tickets created in it)
perl -Ilib sbin/rt-shredder --force --plugin 'Objects=Queue,<ID>'

# Groups
perl -Ilib sbin/rt-shredder --force --plugin 'Objects=Group,<ID>'

# Custom Fields
perl -Ilib sbin/rt-shredder --force --plugin 'Objects=CustomField,<ID>'

# Lifecycle (stored in DB config, not a shredder object)
curl -s -X DELETE -H "Authorization: token <TOKEN>" \
     http://<RT_URL>/REST/2.0/lifecycle/<name>
```

The shredder walks dependencies, so removing the queue will also remove any tickets created in it. Groups must be removed separately. SQL dump files are created automatically for each shredder operation in case you need to restore.

### Test Scenarios

Two scenarios have been validated. Use these or create new ones.

#### Scenario A: Facilities Department (Request/Fulfillment)

**Persona:** Director of Facilities Management at a mid-sized university.

**Key characteristics:**
- Handles repairs, cleaning, restocking, landscaping, general maintenance
- Anyone on campus submits via email, web form, or phone
- Front desk staff create tickets for phone calls
- Operations manager triages, sets priority, routes to crews
- Wants "waiting" status instead of "stalled" with a reason (parts, weather, vendor)
- Categorize by department (Plumbing, Electrical, Custodial, etc.)
- Separate manager group with reassignment rights

**Expected outcome:**
- Custom "facilities" lifecycle (new, open, waiting, resolved, rejected, deleted)
- One queue with Department and Waiting Reason custom fields
- Two groups (Staff, Managers) with managers nested in staff
- ~20 rights grants, all 201 status

#### Scenario B: Building Permit Office (Pipeline/Compliance)

**Persona:** Director of Building and Permitting Services for a county government.

**Key characteristics:**
- Sequential pipeline: submitted → intake review → plan review → inspections → finalized
- Revision loops (plan review ↔ revisions requested) and inspection loops (inspection ↔ corrections required)
- Permits can be denied or withdrawn
- Distinct roles: intake clerks, plan reviewers, field inspectors, supervisors
- Annual state audits — NO deletions allowed, full history required
- Read-only auditor group
- Categorize by permit type (Residential/Commercial × New/Renovation, Demolition)
- Inspection stage tracking (Foundation, Framing, Electrical, Plumbing, Final)

**Expected outcome:**
- Custom "building-permits" lifecycle with 9+ statuses
- One queue (user may push back on multi-queue recommendation)
- Four groups (Intake, Staff, Supervisors nested in Staff, Auditors read-only)
- No DeleteTicket granted to any principal
- ~30+ rights grants

#### Creating New Scenarios

Good test scenarios should exercise different workflow patterns from the prompt:

- **Approval-Gated**: Work requiring sign-off before proceeding (grant proposals, budget requests)
- **Triage/Routing**: Central intake with sorting and routing (service desk, bug intake)
- **Internal Tracking**: Team tracks own work, no external requester (project tasks, sprint backlogs)

For each scenario, write a persona prompt that includes:
- Character background (role, experience, technical level)
- Department facts (work types, team size, how work arrives)
- Specific preferences that test prompt features (custom statuses, compliance needs, notification requirements)
- At least one point where the user should push back on the AI's recommendation

### What to Watch For

**Signs the prompt is working well:**
- Consultant asks one question at a time, not a checklist
- Discovery converges in 4-6 turns
- Plan is opinionated (recommends, doesn't list options)
- Group nesting suggested when there's a superset relationship
- Watchers and notifications discussed during discovery
- Staff get CreateTicket rights
- Bulk CF values used (one tool call, not N calls)
- System groups and roles resolved by name without errors

**Signs something needs tuning:**
- Consultant asks too many questions per turn
- Discovery drags past 6-7 turns without converging
- Plan presents options instead of making recommendations
- Rights granted to system groups fail with "Group not found"
- CF values added one at a time
- DeleteTicket granted when compliance was discussed
- Watchers never mentioned during discovery
- Group members not asked about
