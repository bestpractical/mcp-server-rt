# Changelog

## [Unreleased]

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
