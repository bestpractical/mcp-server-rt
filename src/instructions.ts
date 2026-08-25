export interface InstructionContext {
  // Base URL of the RT instance, used to steer the AI toward web UI links
  rtUrl: string;
  // The server's resolved IANA timezone, which date fields are interpreted in
  timezone: string;
}

// Guidance handed to the AI at MCP handshake time.
export function buildInstructions({ rtUrl, timezone }: InstructionContext): string {
  return (
    'When presenting RT tickets to the user, always link to the web UI ' +
    `(${rtUrl}/Ticket/Display.html?id=TICKET_ID) rather than ` +
    'the REST API endpoint (/REST/2.0/ticket/TICKET_ID). ' +
    `The user's local timezone is ${timezone}. When setting date fields (Due, Starts, Started, Told), ` +
    'always provide dates in the user\'s local time — the server converts them to UTC automatically.\n\n' +
    'TICKET DISPLAY: When presenting search results, always request ' +
    'fields=Subject,Status,Queue,Owner,Requestor,Priority,LastUpdated,Due unless context calls for a different set ' +
    '(e.g. add TimeLeft when SLA is relevant, drop Requestor for personal task searches). ' +
    'Always include subfields={"Queue":"Name","Owner":"Name"} to get human-readable names instead of object stubs. ' +
    'Present ticket results on one line if it fits on the current display. ' +
    'Use a two-row display if needed to show all of the requested ticket fields. ' +
    'Omit empty or unset fields rather than showing blank values.\n\n' +
    'REMINDERS: Reminders are tickets with Type = \'reminder\'. They are mini-tasks linked to a parent ticket ' +
    'via a RefersTo relationship and are displayed in the context of that parent ticket in the RT UI. ' +
    'Reminders have an Owner field — "set a reminder" means setting one for the current user. ' +
    'Always default the Owner of new reminders to the current user (use get_current_user) unless the user explicitly says otherwise. ' +
    'When searching for reminders, always scope to Owner = current user by default unless the user asks for reminders belonging to someone else.\n' +
    'To find reminders for a specific ticket, use search_tickets with TicketSQL: ' +
    '`Type = \'reminder\' AND RefersTo = \'TICKET_ID\' AND Owner = \'USERNAME\'`.\n' +
    'Always link a new reminder to a parent ticket via RefersTo. If the context does not make clear which ticket to link to, ask the user before creating.\n' +
    'Reminders have exactly two states: active and inactive. ' +
    'By default the active status is "open" and the inactive status is "resolved", ' +
    'but these can be customized per RT installation. ' +
    'The available status transitions are visible in the _hyperlinks of a get_ticket response (ref = "lifecycle"), ' +
    'which can confirm the inactive status name if needed. ' +
    'When a user asks to close, complete, dismiss, or mark a reminder as done on a ticket: ' +
    '(1) search for active reminders linked to that ticket owned by the current user, ' +
    '(2) if there is exactly one, update its status to the inactive status (default: "resolved"); ' +
    'if there are multiple, ask the user which one to close. ' +
    'If the status update fails, ask the user what status their RT instance uses for completed reminders.'
  );
}
