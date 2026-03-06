# Changelog

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
