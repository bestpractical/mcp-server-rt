# Changelog

## [Unreleased]

### Fixed
- URL rewriting no longer breaks pagination on ticket sub-collections. Rewriting REST ticket URLs to web UI URLs matched on the ticket ID and discarded the rest of the path, so the `next_page` link returned by `get_ticket_attachments` and `get_ticket_history` was replaced by the ticket's display page and could not be followed. Only a ticket's own URL is rewritten now, which also leaves the `history`, `correspond`, and `comment` entries in a ticket's `_hyperlinks` as the distinct endpoints they are rather than collapsing all three into the same display link.
- Collection tools no longer return id-only stubs. RT's collection endpoints omit every field unless asked for one, so `get_ticket_attachments` returned no names, types, or sizes, `lookup_user` returned no real names or email addresses, and `search_tickets` and `get_ticket_history` returned nothing but IDs whenever the AI omitted `fields`. Each now sends a sensible default that the caller can override, and `search_tickets` also expands Queue and Owner to names by default. `get_ticket_attachments` and `lookup_user` gained a `fields` parameter to override theirs. Each tool's schema names its own default and says that `fields` — and `subfields` on `search_tickets` — replaces that default rather than adding to it, so a narrowed set has to list every field it keeps.

### Improved
- `get_ticket_history` tells the AI which entries carry raw IDs. Most transactions name the field changed in `Field` and carry its old and new values, but two kinds do not: an owner or watcher change (`SetWatcher`, `AddWatcher`, `DelWatcher`) stores a numeric user ID in `OldValue` and `NewValue`, and a custom field change stores the field's numeric ID in `Field` with the values in `OldReference` and `NewReference`, leaving `OldValue` and `NewValue` empty. Nothing here resolves a user ID to a name — `lookup_user` matches on `Name` and `EmailAddress` — so the AI is told to describe such a change rather than present a username it had no way to look up. `get_queue_fields` does map a custom field ID to its name, and the description says so.
- The ticket display guidance gives the reason a field would be dropped from the default set instead of only naming a situation: `Owner` repeats the question back when the user asked for their own tickets, and `Requestor` earns nothing when they are scanning their task list for what to do next rather than for who asked. The guidance no longer restates the default field list, which reaches the AI through the tool schemas instead.
- Guidance and handling for HTML versus plain text fields. Ticket `Description` is HTML, so a bare newline rendered as nothing and multi-line text arrived as one run-on paragraph; a `Description` that is plain text with line breaks and no tag RT would render is now converted to paragraphs, with its angle brackets escaped so RT keeps them, while anything containing real markup is passed through untouched. `get_queue_fields` reports a `ContentFormat` for every custom field — `html`, `plain-text-multiline`, `plain-text`, `wikitext`, `file`, `date` or `datetime` — since RT's `Text`, `HTML`, and `Freeform` types render differently and the type name alone does not say what to send. The AI instructions describe each format, and are explicit that while RT escapes a bare `<`, `&` or `>` in prose, it silently deletes anything that parses as a tag it does not allow along with the text inside it — so an address like `<bob@example.com>` has to be escaped or it is lost with no error.

### Fixed
- Reminder searches no longer miss reminders. The AI instructions stated that a reminder's active status is `open`, but the status a reminder starts in depends on how it was created: through the ticket API, which is what this server uses, it starts in the queue lifecycle's `on_create` status — `new` in RT's default lifecycle — while the RT web UI starts it in that lifecycle's `reminder_on_open` status, `open` by default. One ticket can hold both, so `Status = 'open'` matched nothing on stock RT and "show me my open reminders" reported none. The instructions now require `Status = '__Active__'`, which matches the initial and active statuses of every lifecycle and is the same query RT's own reminder listing uses.
- `get_queue_fields` now reports all three groups of custom fields RT keeps on a queue, not just the ticket fields. Fields applied to the queue object itself are returned as `QueueCustomFields` (with the queue's `CurrentValues`), and fields applied to transactions as `TransactionCustomFields`. RTIR keeps `RTIR Constituency` and `RTIR default WHOIS server` on the queue object, so those were previously reported as missing from every RTIR queue no matter what rights the user held.
- `get_queue_fields` no longer silently omits custom fields. RT lists a queue's custom fields using the queue as ACL context, so a field whose `SeeCustomField` right is granted at queue level is visible there but forbidden when fetched individually. Those failed fetches were discarded, so the queue could report fewer fields than it has — or none at all. Every applied field is now always listed; when its details cannot be read the entry carries `id`, `Name`, and a `DetailsUnavailable` message.

### Added
- `CustomFields` on `add_comment` and `add_reply`, so a comment or reply and its ticket custom field changes happen in one tool call instead of requiring a separate `update_ticket` call. RT applies the custom fields after recording the Comment or Correspond transaction, each as its own `CustomField` transaction — scrips firing on the comment or reply still see the previous values.

### Fixed
- `npm test` now runs `tsc --noEmit` before the test suite, and the pre-existing `CreateTicketFields` cast error in `convertDates` is resolved.
- `add_comment` and `add_reply` treat an explicit `null` `CustomFields` as omitted, rather than sending `"CustomFields": null` to RT.
- `update_ticket` now tells the AI that a custom field value replaces the field's entire contents, so setting one value on a multi-value field no longer silently drops the others.

### Internal
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
