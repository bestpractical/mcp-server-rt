export interface InstructionContext {
  // Base URL of the RT instance, used to steer the AI toward web UI links
  rtUrl: string;
  // The server's resolved IANA timezone, which date fields are interpreted in
  timezone: string;
}

// Guidance handed to the AI at MCP handshake time. Two rules worth keeping in
// mind when editing: state RT concepts in terms the AI can verify from a
// response rather than hardcoded values, and prefer TicketSQL meta-values such
// as __Active__ over literal status names, which are configurable per
// installation. Where a default has to be named, say that it is a default and
// tell the AI how to confirm the real value.
export function buildInstructions({ rtUrl, timezone }: InstructionContext): string {
  return (
    'When presenting RT tickets to the user, always link to the web UI ' +
    `(${rtUrl}/Ticket/Display.html?id=TICKET_ID) rather than ` +
    'the REST API endpoint (/REST/2.0/ticket/TICKET_ID). ' +
    `The user's local timezone is ${timezone}. When setting date fields (Due, Starts, Started, Told), ` +
    'always provide dates in the user\'s local time — the server converts them to UTC automatically.\n\n' +
    'TICKET DISPLAY: search_tickets already requests a useful default field set, with Queue and ' +
    'Owner expanded to names rather than object stubs. Pass fields or subfields only when the ' +
    'context calls for a different set: add a field the question turns on, such as TimeLeft when ' +
    'SLA is relevant, and drop one that will not tell the user anything — Owner when they asked ' +
    'for their own tickets and every row is theirs, or Requestor when they are scanning their own ' +
    'task list for what to do next rather than for who asked. A row has to fit a narrow display, ' +
    'so every column shown should be one they need. Each of fields and subfields replaces the ' +
    'default rather than adding to it, so list every field you want, and the tool schema names ' +
    'the defaults. ' +
    'Present ticket results on one line if it fits on the current display. ' +
    'Use a two-row display if needed to show all of the requested ticket fields. ' +
    'Omit empty or unset fields rather than showing blank values.\n\n' +
    'CONTENT FORMATTING: The ticket Description field is HTML. A plain newline produces no line ' +
    'break there, so use <p> for paragraphs and <br /> for single breaks. If you do pass plain text ' +
    'with line breaks and no markup at all, the server converts it to paragraphs for you.\n' +
    'Custom field values depend on the field, and get_queue_fields reports a ContentFormat for each ' +
    'one. "html" means send HTML, because newlines alone will not render. "plain-text-multiline" ' +
    'means send plain text and RT turns the newlines into line breaks. "plain-text" means the value ' +
    'is shown exactly as typed, so markup appears literally and newlines do not break lines. ' +
    '"wikitext" means wiki markup rather than HTML. "file" means the field holds an uploaded image ' +
    'or attachment, not text you can set as a string. "date" holds a date and "datetime" a date and ' +
    'time; send those in the user\'s local time, which RT interprets in their own timezone. ' +
    'Check ContentFormat before writing a multi-line or formatted value to a custom field.\n' +
    'RT escapes a bare <, & or > in running text and does not double-escape an entity you have ' +
    'already escaped, so ordinary punctuation is safe to send as typed. What RT will not do is keep ' +
    'angle brackets that parse as a tag it does not allow: it deletes that tag and the text inside ' +
    'it, silently, and the response still reports success. So write angle brackets that are not ' +
    'markup as &lt; and &gt; yourself — an address like &lt;bob@example.com&gt; or a placeholder ' +
    'like &lt;PID&gt; is lost otherwise, in the Description and in any custom field whose ' +
    'ContentFormat is "html", "plain-text-multiline" or "wikitext".\n\n' +
    'PRIORITY: RT stores priority as a number, and an installation can map labels like Low, ' +
    'Medium, High onto numbers, per queue. create_ticket and update_ticket take either form. ' +
    'RT resolves a label itself, and it does not reject one that is not in the queue\'s mapping, ' +
    'nor a label sent to an installation that has no mapping at all: it sets the priority to 0, ' +
    'the lowest, and still reports success. Nothing in the response flags this as an error, so ' +
    'never treat having sent a label as having set it. RT does report the change it made, naming ' +
    'the label it landed on — "Priority changed from X to Y", carried as PrioritySet on create — ' +
    'so read that back, and if the label it names is not the one you asked for, say so rather ' +
    'than reporting the priority as set. Use the exact label RT shows on tickets in that queue, ' +
    'and send a number when you do not know it.\n\n' +
    'TICKET LINKS: update_ticket changes links only through AddRefersTo and DeleteRefersTo, ' +
    'and the matching Add/Delete pair for ReferredToBy, DependsOn, DependedOnBy, Parent and Child. ' +
    'Do not pass a bare relation name such as RefersTo, Parent or Children to update_ticket: RT reads ' +
    'that as "these are now the only links of this type" and silently removes the others, so ' +
    'update_ticket refuses it and changes nothing. Each field takes one ticket ID, an array of IDs, ' +
    'or an external URI, so add several links in one call rather than one call each. ' +
    'To replace a link, delete the old one and add the new one. ' +
    'A ticket\'s existing links are in the _hyperlinks of a get_ticket response, each carrying the ' +
    'linked ticket\'s id and a "ref" naming the relation — "refers-to", "referred-to-by", ' +
    '"depends-on", "depended-on-by", "parent" for what AddParent sets, and "child" for AddChild. ' +
    'Read those before deleting, so you delete the link the user meant and leave the rest. ' +
    'create_ticket does accept the bare relation names, because a new ticket has no links to remove.\n\n' +
    'REMINDERS: Reminders are tickets with Type = \'reminder\'. They are mini-tasks linked to a parent ticket ' +
    'via a RefersTo relationship and are displayed in the context of that parent ticket in the RT UI. ' +
    'Reminders have an Owner field — "set a reminder" means setting one for the current user. ' +
    'Always default the Owner of new reminders to the current user (use get_current_user) unless the user explicitly says otherwise. ' +
    'When searching for reminders, always scope to Owner = current user by default unless the user asks for reminders belonging to someone else.\n' +
    'To find reminders for a specific ticket, use search_tickets with TicketSQL: ' +
    '`Type = \'reminder\' AND RefersTo = \'TICKET_ID\' AND Owner = \'USERNAME\'`, ' +
    'adding `AND Status = \'__Active__\'` to list only the ones still outstanding.\n' +
    'Always link a new reminder to a parent ticket via RefersTo. If the context does not make clear which ticket to link to, ask the user before creating.\n' +
    'Reminders have exactly two states: active and inactive. ' +
    'Never search for reminders by a literal status name. The status a reminder starts in depends on how it ' +
    'was created: this server creates reminders through the ticket API, so they start in the queue lifecycle\'s ' +
    'on_create status ("new" in RT\'s default lifecycle), while a reminder created in the RT web UI starts in ' +
    'that lifecycle\'s reminder_on_open status ("open" by default). One ticket can hold both, so no literal ' +
    'status name finds them all. ' +
    'Always use Status = \'__Active__\' to find outstanding reminders, which matches the initial and active ' +
    'statuses of every lifecycle, and Status = \'__Inactive__\' for completed ones. This is the same query ' +
    'RT\'s own reminder listing uses.\n' +
    'When a user asks to close, complete, dismiss, or mark a reminder as done on a ticket: ' +
    '(1) search for active reminders linked to that ticket owned by the current user using Status = \'__Active__\', ' +
    '(2) if there are multiple, ask the user which one to close, ' +
    '(3) set the chosen reminder to the lifecycle\'s inactive status for reminders, which is "resolved" unless ' +
    'the installation configures reminder_on_resolve differently. ' +
    'The statuses that reminder can move to are listed in the _hyperlinks of a get_ticket response ' +
    '(ref = "lifecycle", each carrying a "to" status); if "resolved" is not among them, choose the inactive ' +
    'status from that list, and ask the user if none of them is clearly the completed state.\n\n' +
    'QUEUE SETUP: When helping create a new queue, follow this sequence:\n' +
    '(1) list_lifecycles to show available workflows,\n' +
    '(2) create_queue with name, description, lifecycle,\n' +
    '(3) list_groups to check for existing groups, then create_group if needed\n' +
    '    and add_group_members to populate staff groups,\n' +
    '(4) create custom fields if needed (create_custom_field + add_custom_field_value\n' +
    '    for select types + apply_custom_field),\n' +
    '(5) grant_rights to set up permissions for Everyone, Requestor role, and staff group,\n' +
    '(6) manage_queue_watchers to assign Cc/AdminCc members.\n' +
    'Always confirm the plan with the user before making changes.\n\n' +
    'These tools need administrative rights, and RT answers 403 Forbidden when they are ' +
    'missing: every lifecycle tool requires SuperUser, create_queue and update_queue require ' +
    'AdminQueue, create_group requires AdminGroup, and add_group_members requires ' +
    'AdminGroupMembership. A Forbidden here ' +
    'means the account lacks the right, not that the tool is broken — say which right is ' +
    'needed rather than retrying. list_lifecycles is the first step and the most likely to ' +
    'fail this way, so check it before promising the user a plan you cannot carry out.\n\n' +
    'PARTIAL UPDATES: update_ticket, update_queue, and manage_queue_watchers apply each ' +
    'field independently, and they return success even when some of those fields failed. ' +
    'The result is an array holding one message per attempted change, successes and failures ' +
    'mixed together and in no particular order — a single response can read ' +
    '["That user does not exist", "Subject changed from \'x\' to \'y\'"], meaning the subject ' +
    'was renamed and the owner was silently left alone. Never conclude the call worked ' +
    'because it returned without an error. Read every message, confirm each change you asked ' +
    'for actually applied, and tell the user about any that did not, naming the value that ' +
    'was rejected. Failures are phrased many ways and are translated on non-English ' +
    'instances, so read for meaning rather than matching set phrases. ' +
    'The most common cause is a name RT could not resolve: watchers and owners must be a ' +
    'username, an email address, or a numeric ID, and a group has to be written as ' +
    '"group:Group Name" or it is looked up as a user and fails.'
  );
}
