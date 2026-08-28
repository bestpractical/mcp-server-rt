# Changelog

## [Unreleased]

### Added
- Queue administration: 26 tools covering queues (`create_queue`, `update_queue`, `manage_queue_watchers`), user-defined groups and their members, custom field creation and application, lifecycles, and rights. Enough to build a working queue end to end without leaving the conversation.
- A `create-queue` MCP prompt, exposed through the new `prompts` capability. It runs an interactive consultant: it asks about the workflow before recommending anything, maps the answers onto RT concepts — lifecycle, groups, roles, rights, custom fields, watchers — then confirms a plan before making changes. The prompt text ships in `data/prompts/create-queue.md`.
- AI instructions for the above. `QUEUE SETUP` gives the order the tools are meant to be used in, and `PARTIAL UPDATES` warns that `update_ticket`, `update_queue`, and `manage_queue_watchers` apply each field independently and return success even when some of those fields failed — a response can read `["That user does not exist", "Subject changed from 'x' to 'y'"]`, meaning the rename applied and the owner was silently left alone. The most common cause is a name RT could not resolve: a group has to be written as `group:Group Name` or it is looked up as a user and fails.
- `manifest.json` now lists all 43 tools. It had drifted to 31, so twelve implemented tools were invisible to anyone browsing the desktop extension. The array is documentation only — `tools/list` is built from the code — so the omission cost discovery rather than access.

### Documentation
- README documents the 26 administration tools and the `create-queue` prompt, which had never appeared there, and names the RT 6.0.3 dependency next to the general RT 6.0 requirement. The tools table is split into ticket work and queue administration.
- TESTING.md gains a live plan for the administration tools — section 15 — alongside the ported guide for driving the `create-queue` prompt with paired agents. The section calls out the two places RT's behaviour surprises a caller: a group watcher has to be passed as `group:Group Name` or the call reports failure inside an otherwise successful response, and a successful `delete_lifecycle` answers 204 with no body.

### Requirements
- The lifecycle and rights tools need **RT 6.0.3 or later**. RT's REST2 `Lifecycle` and `Rights` resources were added in that release; the queue, group, and custom field tools work against earlier RT 6.0.x. This is why the release is 0.3.0 rather than 0.2.2.

### Fixed
- `list_groups` and `search_custom_fields` no longer return id-only stubs. Both schemas already documented a default field set, but the client sent none, so RT answered with nothing but IDs. The documented defaults are now actually sent, and the descriptions interpolate them so the two cannot drift apart again. `list_custom_field_applications`, `list_rights`, and `list_lifecycles` needed no change — RT returns usable data from those without being asked.
- `list_group_members` says what RT actually returns. That collection ignores a `fields` parameter, so it yields only an id and a type per member; the description now says so, points at `get_group` for group members, and tells the AI to describe a user member by id rather than inventing a name it had no way to look up.
- A successful `DELETE` that returns 204 with no body no longer throws. `request` always tried to parse a response body, so `delete_lifecycle` failed on every successful delete.

### Internal
- Prompt loading lives in `src/prompts.ts`, and the one assumption both bundled-data readers depend on — that `data/` sits beside the built script — is now written once in `src/data-files.ts`. `loadPrompts` deliberately degrades to no prompts if the file cannot be read, so a packaging mistake would otherwise be invisible; `src/__tests__/prompts.test.ts` covers both the loaded and missing cases, and `get_ticketsql_grammar`, the other reader, gained its first test.

## [0.2.2] - 2026-08-27

### Changed
- **Breaking:** `update_ticket` no longer accepts a bare link relation such as `RefersTo`. Setting one syncs that relation to exactly the value given and silently removes every other link of the type, which is a destructive default when an AI is asked to add a link. Links are now changed only through `AddRefersTo`/`DeleteRefersTo` and the equivalents for `ReferredToBy`, `DependsOn`, `DependedOnBy`, `Parent`, and `Child`; each takes one ID, an array of IDs, or an external URI. Passing a bare relation — including RT aliases like `Children` or `MemberOf` — is refused with a message naming the incremental fields, and no links are changed. The AI instructions and `update_ticket`'s own description say all of this before the call, so an AI that knows RT's API does not have to learn it from the error, and they name where a ticket's current links can be read — the `_hyperlinks` of a `get_ticket` response, each under a `ref` whose name is not the field that sets it, `parent` for `AddParent` and `child` for `AddChild` — since replacing a link now means naming the one to delete. To replace a link, delete the old one and add the new one. `create_ticket` is unaffected, since a new ticket has no links to remove.

### Added
- `Priority` on `create_ticket` and `update_ticket` now accepts a label as well as a number, so the AI can use the priority names RT displays (e.g. Low, Medium, High) instead of guessing at numbers. RT resolves labels against the queue's own `PriorityAsString` mapping. `update_ticket` passes the value straight through; `create_ticket` applies a label in a follow-up update, because RT cannot resolve one while creating a ticket, and reports `PriorityNotSet` if that step fails outright. Labels are case-sensitive and configured per queue.
- A priority label that RT does not recognize no longer passes unremarked. RT does not reject an unknown label — `SetPriority` falls back to 0, the lowest priority, and reports success, and the same happens to any label on an installation with `$EnablePriorityAsString` off. The server cannot validate a label up front, because REST2 exposes neither the queue's mapping nor a ticket's `PriorityAsString`, so instead it surfaces the evidence RT does give: `create_ticket` returns the priority change RT reported as `PrioritySet` rather than discarding it, and both tools tell the AI to check the label RT names in that report against the one it asked for and to say so when they differ.
- `CustomFields` on `add_comment` and `add_reply`, so a comment or reply and its ticket custom field changes happen in one tool call instead of requiring a separate `update_ticket` call. RT applies the custom fields after recording the Comment or Correspond transaction, each as its own `CustomField` transaction — scrips firing on the comment or reply still see the previous values.

### Improved
- Guidance and handling for HTML versus plain text fields. Ticket `Description` is HTML, so a bare newline rendered as nothing and multi-line text arrived as one run-on paragraph; a `Description` that is plain text with line breaks and no tag RT would render is now converted to paragraphs, with its angle brackets escaped so RT keeps them, while anything containing real markup is passed through untouched. `get_queue_fields` reports a `ContentFormat` for every custom field — `html`, `plain-text-multiline`, `plain-text`, `wikitext`, `file`, `date` or `datetime` — since RT's `Text`, `HTML`, and `Freeform` types render differently and the type name alone does not say what to send. The AI instructions describe each format, and are explicit that while RT escapes a bare `<`, `&` or `>` in prose, it silently deletes anything that parses as a tag it does not allow along with the text inside it — so an address like `<bob@example.com>` has to be escaped or it is lost with no error.
- `get_ticket_history` tells the AI which entries carry raw IDs. Most transactions name the field changed in `Field` and carry its old and new values, but two kinds do not: an owner or watcher change (`SetWatcher`, `AddWatcher`, `DelWatcher`) stores a numeric user ID in `OldValue` and `NewValue`, and a custom field change stores the field's numeric ID in `Field` with the values in `OldReference` and `NewReference`, leaving `OldValue` and `NewValue` empty. Nothing here resolves a user ID to a name — `lookup_user` matches on `Name` and `EmailAddress` — so the AI is told to describe such a change rather than present a username it had no way to look up. `get_queue_fields` does map a custom field ID to its name, and the description says so.
- The ticket display guidance gives the reason a field would be dropped from the default set instead of only naming a situation: `Owner` repeats the question back when the user asked for their own tickets, and `Requestor` earns nothing when they are scanning their task list for what to do next rather than for who asked. The guidance no longer restates the default field list, which reaches the AI through the tool schemas instead.

### Fixed
- Reminder searches no longer miss reminders. The AI instructions stated that a reminder's active status is `open`, but the status a reminder starts in depends on how it was created: through the ticket API, which is what this server uses, it starts in the queue lifecycle's `on_create` status — `new` in RT's default lifecycle — while the RT web UI starts it in that lifecycle's `reminder_on_open` status, `open` by default. One ticket can hold both, so `Status = 'open'` matched nothing on stock RT and "show me my open reminders" reported none. The instructions now require `Status = '__Active__'`, which matches the initial and active statuses of every lifecycle and is the same query RT's own reminder listing uses.
- `get_queue_fields` no longer silently omits custom fields. RT lists a queue's custom fields using the queue as ACL context, so a field whose `SeeCustomField` right is granted at queue level is visible there but forbidden when fetched individually. Those failed fetches were discarded, so the queue could report fewer fields than it has — or none at all. Every applied field is now always listed; when its details cannot be read the entry carries `id`, `Name`, and a `DetailsUnavailable` message.
- `get_queue_fields` now reports all three groups of custom fields RT keeps on a queue, not just the ticket fields. Fields applied to the queue object itself are returned as `QueueCustomFields` (with the queue's `CurrentValues`), and fields applied to transactions as `TransactionCustomFields`. RTIR keeps `RTIR Constituency` and `RTIR default WHOIS server` on the queue object, so those were previously reported as missing from every RTIR queue no matter what rights the user held.
- Collection tools no longer return id-only stubs. RT's collection endpoints omit every field unless asked for one, so `get_ticket_attachments` returned no names, types, or sizes, `lookup_user` returned no real names or email addresses, and `search_tickets` and `get_ticket_history` returned nothing but IDs whenever the AI omitted `fields`. Each now sends a sensible default that the caller can override, and `search_tickets` also expands Queue and Owner to names by default. `get_ticket_attachments` and `lookup_user` gained a `fields` parameter to override theirs. Each tool's schema names its own default and says that `fields` — and `subfields` on `search_tickets` — replaces that default rather than adding to it, so a narrowed set has to list every field it keeps.
- URL rewriting no longer breaks pagination on ticket sub-collections. Rewriting REST ticket URLs to web UI URLs matched on the ticket ID and discarded the rest of the path, so the `next_page` link returned by `get_ticket_attachments` and `get_ticket_history` was replaced by the ticket's display page and could not be followed. Only a ticket's own URL is rewritten now, which also leaves the `history`, `correspond`, and `comment` entries in a ticket's `_hyperlinks` as the distinct endpoints they are rather than collapsing all three into the same display link.
- `add_comment` and `add_reply` treat an explicit `null` `CustomFields` as omitted, rather than sending `"CustomFields": null` to RT.
- `update_ticket` now tells the AI that a custom field value replaces the field's entire contents, so setting one value on a multi-value field no longer silently drops the others.

### Internal
- `npm test` now runs `tsc --noEmit` before the test suite, and the pre-existing `CreateTicketFields` cast error in `convertDates` is resolved.
- `HistoryOptions` and `UserSearchOptions` collapsed into one `CollectionOptions`, shared by `get_ticket_history`, `get_ticket_attachments` and `lookup_user`, with `SearchOptions` extending it. Adding `fields` to the user options had made the two identical, and `get_ticket_attachments` had always borrowed the history type for a third purpose.
- The tool schemas interpolate `DEFAULT_FIELDS` rather than restating each default set in prose, so every default field list is written in exactly one place — `list_queues` included, whose default moved off the `listQueues` signature. The rendered descriptions are unchanged apart from `list_queues`, which now states the replace behaviour like the rest.
- Split `src/index.ts`: the tool definitions and argument wiring moved to `src/tools.ts`, leaving `index.ts` as the server bootstrap. `callTool` now takes the `RTClient` as a parameter, which makes the tool schemas and argument pass-through testable (`src/__tests__/tools.test.ts`).

## [0.2.1] - 2026-03-13

### Fixed
- Clarified `update_ticket` description to explicitly tell the AI to pass fields as top-level parameters, not a nested `fields` object.

### Metadata
- Added `server.json` for publishing to the MCP Registry (`registry.modelcontextprotocol.io`).
- Updated `privacy_policies` in `manifest.json` to use the required object format.
- Added attachment tools to README tools table.

## [0.2.0] - 2026-03-06

### Added
- Reminder support: reminders are tickets with `Type = 'reminder'`, linked to a parent ticket via `RefersTo`. The AI now knows how to find, create, and close reminders, defaulting to the current user as owner.
- Attachment support: upload files when creating tickets or adding comments/replies, and download attachments to local files.
- `Type` field on `create_ticket` and `update_ticket` to support creating reminders and other non-standard ticket types.
- `Description` field on `create_ticket` and `update_ticket`.

### Improved
- Ticket links in all responses now point to the RT web UI rather than the REST API.
- Date fields (Due, Starts, Started, Told) are automatically converted from the user's local timezone to UTC.
- AI guidance for TicketSQL: `search_tickets` and `get_ticketsql_grammar` now steer the AI to consult the grammar reference before writing queries, with explicit callout of `__Active__`/`__Inactive__` meta-values.
- AI guidance for search result display: default field set and adaptive one- or two-line display format.
- `search_tickets` and `get_ticket` now support a `subfields` parameter to expand object fields (e.g. Queue, Owner) inline with human-readable names instead of object stubs.
- AI instructions corrected to use `RefersTo = 'TICKET_ID'` (not `ticket/TICKET_ID`) in TicketSQL when searching for linked tickets such as reminders.

## [0.1.1] - 2024-11-18

### Added
- Initial release
- 14 tools covering ticket search, read, create, update, history, queues, users, and TicketSQL grammar reference
- Full support for RT custom fields, custom roles, links, date fields, and watchers on create and update
- Bundled TicketSQL grammar reference for RT 6.0.2
- Desktop extension (`.mcpb`) for one-click installation in Claude Desktop and Claude Cowork
