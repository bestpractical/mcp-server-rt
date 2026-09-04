import { readFileSync, writeFileSync, statSync } from 'fs';
import { basename, extname, join } from 'path';

// MIME type lookup for common extensions (used when FileType is not supplied with FilePath)
const MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function resolveAttachment(a: AttachmentInput): { FileName: string; FileType: string; FileContent: string } {
  if (a.FilePath) {
    const name = a.FileName ?? basename(a.FilePath);
    const type = a.FileType ?? MIME_TYPES[extname(a.FilePath).toLowerCase()] ?? 'application/octet-stream';
    const content = readFileSync(a.FilePath).toString('base64');
    return { FileName: name, FileType: type, FileContent: content };
  }
  if (!a.FileContent) throw new Error('AttachmentInput requires either FilePath or FileContent');
  if (!a.FileName) throw new Error('AttachmentInput requires FileName when using FileContent');
  if (!a.FileType) throw new Error('AttachmentInput requires FileType when using FileContent');
  return { FileName: a.FileName, FileType: a.FileType, FileContent: a.FileContent };
}

// Shared by every paginated collection endpoint. Each one sends its own
// default field set (see DEFAULT_FIELDS); fields replaces that default rather
// than adding to it.
export interface CollectionOptions {
  per_page?: number;
  page?: number;
  fields?: string;
}

export interface SearchOptions extends CollectionOptions {
  orderby?: string;
  order?: 'ASC' | 'DESC';
  subfields?: Record<string, string>;
}

// A custom field reference as it appears on a queue record. Queue-level
// references also carry the queue's current values for that field.
interface CustomFieldRef {
  id: number;
  name: string;
  values?: unknown[];
  _url?: string;
}

export interface QueueFieldsResult {
  id: number;
  Name: string;
  Lifecycle: string;
  // Fields applied to tickets in this queue
  CustomFields: unknown[];
  // Fields applied to the queue object itself
  QueueCustomFields: unknown[];
  // Fields applied to transactions on tickets in this queue
  TransactionCustomFields: unknown[];
}

export interface GetTicketOptions {
  fields?: string;
  subfields?: Record<string, string>;
}

type LinkValue = number | number[] | string | string[];

export interface CreateTicketFields {
  Queue: string;
  Subject: string;
  Type?: string;
  Content?: string;
  ContentType?: 'text/plain' | 'text/html';
  Attachments?: AttachmentInput[];
  Description?: string;
  Status?: string;
  Priority?: number | string;
  Owner?: string;
  Requestor?: string | string[];
  Cc?: string | string[];
  AdminCc?: string | string[];
  CustomFields?: Record<string, unknown>;
  CustomRoles?: Record<string, string | string[]>;
  Due?: string;
  Starts?: string;
  Started?: string;
  Told?: string;
  RefersTo?: LinkValue;
  ReferredToBy?: LinkValue;
  DependsOn?: LinkValue;
  DependedOnBy?: LinkValue;
  Parent?: LinkValue;
  Child?: LinkValue;
}

export interface UpdateTicketFields {
  Subject?: string;
  Type?: string;
  Description?: string;
  Status?: string;
  Priority?: number | string;
  Owner?: string;
  Queue?: string;
  CustomFields?: Record<string, unknown>;
  CustomRoles?: Record<string, string | string[]>;
  // Watchers — passing a value replaces the existing list
  Requestor?: string | string[];
  Cc?: string | string[];
  AdminCc?: string | string[];
  // Date/time fields — use format "YYYY-MM-DD HH:MM:SS" (e.g. "2026-03-06 00:00:00")
  Due?: string;
  Starts?: string;
  Started?: string;
  Told?: string; // "Last Contact" in the RT UI
  // Link relationships — incremental only. RT also accepts a bare relation
  // name, but that syncs the relation to exactly the value given and silently
  // drops every other link of the type, so updates go through Add/Delete.
  AddRefersTo?: LinkValue;
  AddReferredToBy?: LinkValue;
  AddDependsOn?: LinkValue;
  AddDependedOnBy?: LinkValue;
  AddParent?: LinkValue;
  AddChild?: LinkValue;
  DeleteRefersTo?: LinkValue;
  DeleteReferredToBy?: LinkValue;
  DeleteDependsOn?: LinkValue;
  DeleteDependedOnBy?: LinkValue;
  DeleteParent?: LinkValue;
  DeleteChild?: LinkValue;
}

export interface AttachmentInput {
  FileName?: string;        // Optional when FilePath is given (defaults to basename)
  FileType?: string;        // Optional when FilePath is given (auto-detected by extension)
  FileContent?: string;     // MIME Base64-encoded content — provide this OR FilePath
  FilePath?: string;        // Absolute path to a local file — server reads and encodes it
}

export interface MessageFields {
  Content?: string;
  ContentType?: 'text/plain' | 'text/html';
  TimeTaken?: number;
  Status?: string;
  Attachments?: AttachmentInput[];
  CustomFields?: Record<string, unknown>;
}

// RT's collection endpoints return id-only stubs unless asked for fields, so
// every collection call sends a default set. Callers can override any of these,
// and passing fields replaces the set rather than adding to it. The tool schemas
// quote these values back to the AI, so this is the only place they are written.
export const DEFAULT_FIELDS = {
  // Enough to identify and triage a ticket from a list without opening it
  tickets: 'Subject,Status,Queue,Owner,Requestor,Priority,LastUpdated,Due',
  // Without these the Queue and Owner of each result are object stubs
  ticketSubfields: { Queue: 'Name', Owner: 'Name' },
  history: 'Type,Field,OldValue,NewValue,Created,Creator',
  attachments: 'Filename,ContentType,ContentLength,Subject',
  users: 'Name,RealName,EmailAddress,Disabled',
  queues: 'Name,Description,Lifecycle,Disabled,SubjectTag,CorrespondAddress,CommentAddress',
  groups: 'Name,Description,Disabled',
  customFields: 'Name,Type,Description,LookupType,MaxValues,Disabled',
};

// How RT renders a custom field value, keyed by CF type. RT dispatches display
// to a ShowCustomField<Type> component and HTML-escapes anything with no such
// component, which gives three behaviours worth telling an AI apart:
//   html                  markup renders; a bare newline shows nothing
//   plain-text-multiline   newlines become <br />; markup also renders
//   plain-text             value is escaped, so markup and newlines show as typed
export const CONTENT_FORMATS: Record<string, string> = {
  HTML: 'html',
  Text: 'plain-text-multiline',
  Wikitext: 'wikitext',
  Binary: 'file',
  Image: 'file',
  Date: 'date',
  DateTime: 'datetime',
};

function contentFormatFor(type: unknown): string | undefined {
  if (typeof type !== 'string') return undefined;
  return CONTENT_FORMATS[type] ?? 'plain-text';
}

// The tags RT's scrubber keeps: @ALLOWED_TAGS from RT::Interface::Web::Scrubber,
// plus the conditionally allowed img. Any other tag RT deletes along with the
// text inside it, so treating "<" alone as a sign of markup loses data —
// "Contact <bob@example.com>" reaches the browser as "Contact ". Text shaped
// like a tag RT would not keep is safer escaped than passed through.
const HTML_TAGS = [
  'a', 'b', 'u', 'p', 'br', 'i', 'hr', 'small', 'em', 'font', 'span', 'strong', 'sub',
  'sup', 's', 'del', 'strike', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ins', 'div', 'ul',
  'ol', 'li', 'dl', 'dt', 'dd', 'pre', 'blockquote', 'bdo', 'table', 'thead', 'tbody',
  'tfoot', 'tr', 'td', 'th', 'figure', 'iframe', 'code', 'img',
];
const HTML_TAG = new RegExp(`<\\/?(?:${HTML_TAGS.join('|')})(?:\\s[^>]*)?\\/?>`, 'i');

// Ticket Description is HTML: RT scrubs it and renders the result raw, so a
// newline produces no line break and multi-line text arrives as one paragraph.
// Escape the angle brackets so RT keeps them; leave "&" alone, because RT
// escapes a bare one itself and does not double-escape an entity, so a
// deliberate "&amp;" survives.
function escapeAngleBrackets(value: string): string {
  return value.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function htmlFromPlainText(value: string): string {
  return escapeAngleBrackets(value.trim())
    .split(/\n\s*\n+/)
    .map((para) => `<p>${para.split('\n').join('<br />')}</p>`)
    .join('');
}

// Convert a value that is unambiguously plain text — it has some content and no
// tag RT would render — and leave anything else as supplied. Only the paragraph
// wrapping needs line breaks. Escaping is what stops RT deleting text shaped
// like a tag it does not allow, and one line of prose needs that as much as
// several do: "contact <bob@example.com> thanks" rendered as "contact  thanks"
// while the same text with a newline survived.
function formatDescription(fields: Record<string, unknown>): Record<string, unknown> {
  const description = fields.Description;
  if (typeof description !== 'string') return fields;
  if (!description.trim()) return fields;
  if (HTML_TAG.test(description)) return fields;
  return {
    ...fields,
    Description: description.includes('\n')
      ? htmlFromPlainText(description)
      : escapeAngleBrackets(description),
  };
}

// A Priority that RT has to look up in the queue's PriorityAsString mapping
// rather than store directly. This has to draw the line exactly where RT's own
// SetPriority draws it — /^\d+$/ on the raw value — or the two paths disagree:
// anything this calls a value goes into the create body untouched, while RT
// resolves the same string as a label on update. That splits "-5" and " 80 "
// two ways, stored verbatim on create and coerced to 0 on update.
function isPriorityLabel(priority: number | string | undefined): priority is string {
  return typeof priority === 'string' && !/^\d+$/.test(priority);
}

// Every bare link name RT accepts (%RT::Link::TYPEMAP, minus MergedInto, which
// RT ignores here). Setting one syncs that relation to exactly the value given,
// silently removing every other link of the type. Several names alias the same
// relation, so the whole list is refused rather than just the six this tool
// used to expose.
const REPLACING_LINK_FIELDS = [
  'RefersTo', 'ReferredToBy', 'DependsOn', 'DependedOnBy', 'Parent', 'Child',
  'MemberOf', 'Parents', 'Member', 'Members', 'Children', 'HasMember',
];

// Date fields that should be converted from local time to UTC before sending to RT
const DATE_FIELDS = new Set(['Due', 'Starts', 'Started', 'Told']);

// Convert a local datetime string ("YYYY-MM-DD HH:MM:SS") to UTC.
// JavaScript parses "YYYY-MM-DDThh:mm:ss" (no Z) as local time, so we can
// round-trip through Date to get the UTC equivalent.
function localToUTC(dateStr: string): string {
  const d = new Date(dateStr.replace(' ', 'T'));
  if (isNaN(d.getTime())) return dateStr;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function convertDates(fields: object): Record<string, unknown> {
  const result = { ...fields } as Record<string, unknown>;
  for (const key of DATE_FIELDS) {
    if (typeof result[key] === 'string') {
      result[key] = localToUTC(result[key] as string);
    }
  }
  return result;
}

// RT only rejects an all-digit name (RT::Record::ValidateName), so a queue,
// group or lifecycle name may contain #, ? or %, each of which changes what a
// URL path means: "Support #1" truncates at the fragment, "R&D?x" grows a query
// string, and "100% Club" is an invalid escape. Encode every segment we
// interpolate. A name containing / stays unreachable — RT's own [^/]+ route
// cannot match one either.
const seg = (value: string | number): string => encodeURIComponent(String(value));

export class RTClient {
  private url: string;
  private token: string;

  constructor(url: string, token: string) {
    this.url = url.replace(/\/$/, '');
    this.token = token;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `token ${this.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  // Rewrite a ticket's own REST URL to its web UI URL so Claude presents
  // clickable links like /Ticket/Display.html?id=123 instead of
  // /REST/2.0/ticket/123. Only the bare ticket URL qualifies: anything below a
  // ticket is a real endpoint, and rewriting those replaced the next_page link
  // of a paginated sub-collection with the ticket's display page.
  private rewriteUrls(data: unknown): unknown {
    if (typeof data === 'string') {
      const prefix = `${this.url}/REST/2.0/ticket/`;
      if (data.startsWith(prefix)) {
        const rest = data.slice(prefix.length);
        if (/^\d+$/.test(rest)) {
          return `${this.url}/Ticket/Display.html?id=${rest}`;
        }
      }
      return data;
    }
    if (Array.isArray(data)) return data.map((item) => this.rewriteUrls(item));
    if (data !== null && typeof data === 'object') {
      return Object.fromEntries(
        Object.entries(data as Record<string, unknown>).map(([k, v]) => [k, this.rewriteUrls(v)]),
      );
    }
    return data;
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    params?: Record<string, string | number | undefined>,
    subfields?: Record<string, string>,
  ): Promise<unknown> {
    const url = new URL(`${this.url}/REST/2.0/${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    if (subfields) {
      for (const [key, value] of Object.entries(subfields)) {
        url.searchParams.set(`fields[${key}]`, value);
      }
    }

    const response = await fetch(url.toString(), {
      method,
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      throw new Error(`${path} failed: ${response.status} ${data.message ?? response.statusText}`);
    }

    // A successful DELETE can come back as 204 with no body to parse.
    if (response.status === 204) return null;

    return this.rewriteUrls(await response.json());
  }

  // Ticket operations

  searchTickets(query: string, opts: SearchOptions = {}): Promise<unknown> {
    return this.request('GET', 'tickets', undefined, {
      query,
      orderby: opts.orderby,
      order: opts.order,
      per_page: opts.per_page,
      page: opts.page,
      fields: opts.fields ?? DEFAULT_FIELDS.tickets,
    }, opts.subfields ?? DEFAULT_FIELDS.ticketSubfields);
  }

  getTicket(id: number, opts: GetTicketOptions = {}): Promise<unknown> {
    return this.request('GET', `ticket/${seg(id)}`, undefined, {
      fields: opts.fields,
    }, opts.subfields);
  }

  async createTicket(fields: CreateTicketFields): Promise<unknown> {
    // RT::Ticket::Create writes Priority straight into an integer column and
    // never resolves a PriorityAsString label, so a label has to be applied
    // afterwards through SetPriority, which resolves it against the queue's
    // own mapping. Numbers (including numeric strings) go in the create body
    // as before.
    const deferredPriority = isPriorityLabel(fields.Priority) ? fields.Priority : undefined;
    const createFields = deferredPriority === undefined
      ? fields
      : { ...fields, Priority: undefined };

    const body = {
      ...formatDescription(convertDates(createFields)),
      Attachments: fields.Attachments?.map(resolveAttachment),
    };
    const created = await this.request('POST', 'ticket', body);

    if (deferredPriority === undefined) return created;

    // Number('') is 0, not NaN, so an id that came back blank has to be ruled
    // out by value rather than by isNaN — otherwise the follow-up would PUT to
    // ticket/0.
    const id = Number((created as { id?: string | number })?.id);
    if (!Number.isInteger(id) || id <= 0) {
      return { ...(created as object), PriorityNotSet: 'Could not determine the new ticket ID' };
    }

    // The ticket exists either way, so report a failed priority update rather
    // than throwing, which would suggest nothing was created.
    try {
      const result = await this.updateTicket(id, { Priority: deferredPriority });

      // RT resolves the label itself and does not reject one it cannot find in
      // the mapping — SetPriority falls back to 0, the lowest priority, and
      // reports success. The server cannot tell the two apart, because REST2
      // exposes neither the queue's mapping nor a ticket's PriorityAsString.
      // What RT does report is the change it made, naming the label it landed
      // on, so pass that back rather than swallowing it: it is the only way the
      // caller can see that "High" became "Low".
      return { ...(created as object), PrioritySet: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ...(created as object), PriorityNotSet: message };
    }
  }

  // async so the link guard rejects rather than throwing at the call site:
  // every other method here hands back a promise no matter what goes wrong.
  async updateTicket(id: number, fields: UpdateTicketFields): Promise<unknown> {
    const replacing = REPLACING_LINK_FIELDS.filter(
      (name) => (fields as Record<string, unknown>)[name] !== undefined,
    );
    if (replacing.length > 0) {
      throw new Error(
        `Cannot update links with ${replacing.join(', ')}: setting a link relation ` +
          'replaces every existing link of that type. Use Add<Relation> to add links ' +
          'and Delete<Relation> to remove them, e.g. AddRefersTo or DeleteRefersTo.',
      );
    }
    return this.request('PUT', `ticket/${seg(id)}`, formatDescription(convertDates(fields)));
  }

  getTicketHistory(id: number, opts: CollectionOptions = {}): Promise<unknown> {
    return this.request('GET', `ticket/${seg(id)}/history`, undefined, {
      per_page: opts.per_page,
      page: opts.page,
      fields: opts.fields ?? DEFAULT_FIELDS.history,
    });
  }

  ticketComment(id: number, fields: MessageFields): Promise<unknown> {
    const body = { ...fields, Attachments: fields.Attachments?.map(resolveAttachment) };
    if (body.Content !== undefined && body.ContentType === undefined) body.ContentType = 'text/plain';
    return this.request('POST', `ticket/${seg(id)}/comment`, body);
  }

  ticketCorrespond(id: number, fields: MessageFields): Promise<unknown> {
    const body = { ...fields, Attachments: fields.Attachments?.map(resolveAttachment) };
    if (body.Content !== undefined && body.ContentType === undefined) body.ContentType = 'text/plain';
    return this.request('POST', `ticket/${seg(id)}/correspond`, body);
  }

  // Attachment operations

  getTicketAttachments(id: number, opts: CollectionOptions = {}): Promise<unknown> {
    return this.request('GET', `ticket/${seg(id)}/attachments`, undefined, {
      per_page: opts.per_page,
      page: opts.page,
      fields: opts.fields ?? DEFAULT_FIELDS.attachments,
    });
  }

  async getAttachment(id: number): Promise<unknown> {
    const a = (await this.request('GET', `attachment/${seg(id)}`)) as {
      ContentType?: string;
      Content?: string;
      [key: string]: unknown;
    };
    if (a.ContentType?.startsWith('text/') && typeof a.Content === 'string') {
      return { ...a, Content: Buffer.from(a.Content, 'base64').toString('utf8') };
    }
    return a;
  }

  async saveAttachment(id: number, destPath: string): Promise<{ savedTo: string; size: number }> {
    const a = (await this.request('GET', `attachment/${seg(id)}`)) as {
      Filename?: string;
      Content?: string;
      [key: string]: unknown;
    };

    if (!a.Content) throw new Error(`Attachment ${id} has no content`);

    // If destPath is a directory, append the original filename
    let outPath = destPath;
    try {
      if (statSync(destPath).isDirectory()) {
        const filename = a.Filename || `attachment-${id}`;
        outPath = join(destPath, filename);
      }
    } catch {
      // destPath doesn't exist yet — treat it as a full file path
    }

    writeFileSync(outPath, Buffer.from(a.Content, 'base64'));
    return { savedTo: outPath, size: statSync(outPath).size };
  }

  // Queue operations

  getQueue(idOrName: string): Promise<unknown> {
    return this.request('GET', `queue/${seg(idOrName)}`);
  }

  listQueues(fields: string | undefined = DEFAULT_FIELDS.queues): Promise<unknown> {
    return this.request('GET', 'queues/all', undefined, { fields });
  }

  // Current user

  async getCurrentUser(): Promise<unknown> {
    const userId = this.token.split('-')[1];
    if (!userId || isNaN(Number(userId))) {
      throw new Error('Could not determine user ID from RT token format');
    }
    const user = (await this.request('GET', `user/${seg(userId)}`)) as Record<string, unknown>;
    const keep = ['id', 'Name', 'RealName', 'EmailAddress', 'Organization', 'Lang', 'Timezone', 'Privileged', 'Disabled'];
    return Object.fromEntries(keep.filter((k) => k in user).map((k) => [k, user[k]]));
  }

  // Transaction operations

  async getTransaction(id: number): Promise<unknown> {
    const txn = (await this.request('GET', `transaction/${seg(id)}`)) as {
      _hyperlinks?: Array<{ ref: string; _url: string; id?: number }>;
      [key: string]: unknown;
    };

    const attachmentRefs = (txn._hyperlinks ?? [])
      .filter((l) => l.ref === 'attachment')
      .map((l) => {
        const id = l.id ?? Number(l._url.split('/').pop());
        return isNaN(id) ? null : id;
      })
      .filter((id): id is number => id !== null);

    const attachments = await Promise.allSettled(
      attachmentRefs.map((id) => this.request('GET', `attachment/${seg(id)}`)),
    );

    const decodedAttachments = attachments
      .filter((r): r is PromiseFulfilledResult<unknown> => r.status === 'fulfilled')
      .map((r) => {
        const a = r.value as { ContentType?: string; Content?: string; [key: string]: unknown };
        if (a.ContentType?.startsWith('text/') && typeof a.Content === 'string') {
          return { ...a, Content: Buffer.from(a.Content, 'base64').toString('utf8') };
        }
        return a;
      });

    return { ...txn, Attachments: decodedAttachments };
  }

  // User operations

  lookupUser(query: string, opts: CollectionOptions = {}): Promise<unknown> {
    const queryArray = [
      { field: 'Name', operator: 'LIKE', value: query },
      { field: 'EmailAddress', operator: 'LIKE', value: query, entry_aggregator: 'OR' },
    ];
    return this.request('POST', 'users', queryArray, {
      per_page: opts.per_page,
      page: opts.page,
      fields: opts.fields ?? DEFAULT_FIELDS.users,
    });
  }

  // Expand a queue record's custom field references into full definitions.
  //
  // The queue record is the authoritative list of applied custom fields: RT
  // builds it with the queue as ACL context, so it includes fields whose
  // SeeCustomField right is granted at queue level rather than globally.
  // Fetching those fields individually carries no such context and can be
  // forbidden, so a failed detail fetch must never drop the field from the
  // list — report it with what the queue already told us instead.
  private async expandCustomFields(refs: CustomFieldRef[]): Promise<unknown[]> {
    const results = await Promise.allSettled(
      refs.map((cf) => this.request('GET', `customfield/${seg(cf.id)}`)),
    );

    return results.map((result, i) => {
      const ref = refs[i];
      // Queue-level fields carry the queue's current values; ticket and
      // transaction field references do not.
      const current = ref.values !== undefined ? { CurrentValues: ref.values } : {};

      if (result.status === 'fulfilled') {
        const cf = result.value as Record<string, unknown>;
        const format = contentFormatFor(cf.Type);
        return { ...cf, ...(format ? { ContentFormat: format } : {}), ...current };
      }
      return {
        id: ref.id,
        Name: ref.name,
        ...current,
        DetailsUnavailable:
          result.reason instanceof Error ? result.reason.message : String(result.reason),
      };
    });
  }

  async getQueueFields(idOrName: string): Promise<QueueFieldsResult> {
    const queue = (await this.request('GET', `queue/${seg(idOrName)}`)) as {
      id: number;
      Name: string;
      Lifecycle: string;
      TicketCustomFields?: CustomFieldRef[];
      CustomFields?: CustomFieldRef[];
      TicketTransactionCustomFields?: CustomFieldRef[];
    };

    // RT keeps three separate groups on a queue record: fields applied to
    // tickets in the queue, fields on the queue object itself (RTIR uses these
    // for Constituency and the default WHOIS server), and fields applied to
    // ticket transactions. Reading only the first reports the others as missing.
    const [customFields, queueCustomFields, transactionCustomFields] = await Promise.all([
      this.expandCustomFields(queue.TicketCustomFields ?? []),
      this.expandCustomFields(queue.CustomFields ?? []),
      this.expandCustomFields(queue.TicketTransactionCustomFields ?? []),
    ]);

    return {
      id: queue.id,
      Name: queue.Name,
      Lifecycle: queue.Lifecycle,
      CustomFields: customFields,
      QueueCustomFields: queueCustomFields,
      TransactionCustomFields: transactionCustomFields,
    };
  }

  // Queue and group administration, ported from the queue-creation work.
  // RT scopes rights either globally or to one object, and the two take
  // different paths under /REST/2.0.
  // Rights operations
  private rightsObjectPath(objectType: string, objectId?: string): string {
    if (objectType === 'global') return 'global';
    // Every other object type needs an id. The schemas mark object_id optional
    // because "global" omits it; without this, a missing one reaches RT as an
    // empty path segment and comes back an opaque 404.
    if (objectId === undefined || objectId === '') {
      throw new Error(`object_id is required when object_type is "${objectType}"; only "global" omits it`);
    }
    return `${seg(objectType)}/${seg(objectId)}`;
  }

  // Queue write operations
  createQueue(fields: Record<string, unknown>): Promise<unknown> {
    return this.request('POST', 'queue', fields);
  }

  updateQueue(idOrName: string, fields: Record<string, unknown>): Promise<unknown> {
    return this.request('PUT', `queue/${seg(idOrName)}`, fields);
  }

  // Lifecycle operations
  listLifecycles(type?: string): Promise<unknown> {
    return this.request('GET', 'lifecycles', undefined, type ? { type } : undefined);
  }

  getLifecycle(name: string): Promise<unknown> {
    return this.request('GET', `lifecycle/${seg(name)}`);
  }

  createLifecycle(data: Record<string, unknown>): Promise<unknown> {
    return this.request('POST', 'lifecycles', data);
  }

  updateLifecycle(name: string, data: Record<string, unknown>): Promise<unknown> {
    return this.request('PUT', `lifecycle/${seg(name)}`, data);
  }

  updateLifecycleMaps(name: string, maps: Record<string, unknown>): Promise<unknown> {
    return this.request('PUT', `lifecycle/${seg(name)}/maps`, maps);
  }

  validateLifecycle(name: string, data: Record<string, unknown>): Promise<unknown> {
    return this.request('POST', `lifecycle/${seg(name)}/validate`, data);
  }

  deleteLifecycle(name: string): Promise<unknown> {
    return this.request('DELETE', `lifecycle/${seg(name)}`);
  }

  getAvailableRights(objectType: string, objectId?: string): Promise<unknown> {
    return this.request('GET', `${this.rightsObjectPath(objectType, objectId)}/rights/available`);
  }

  listRights(objectType: string, objectId?: string, opts: { user?: string; group?: string; per_page?: number; page?: number } = {}): Promise<unknown> {
    return this.request('GET', `${this.rightsObjectPath(objectType, objectId)}/rights`, undefined, {
      user: opts.user,
      group: opts.group,
      per_page: opts.per_page,
      page: opts.page,
    });
  }

  grantRight(objectType: string, objectId: string | undefined, data: object): Promise<unknown> {
    return this.request('POST', `${this.rightsObjectPath(objectType, objectId)}/rights`, data);
  }

  revokeRight(objectType: string, objectId: string | undefined, right: string, principalType: string, principalId: string): Promise<unknown> {
    return this.request('DELETE', `${this.rightsObjectPath(objectType, objectId)}/rights/${seg(right)}/${seg(principalType)}/${seg(principalId)}`);
  }

  bulkRights(objectType: string, objectId: string | undefined, data: object): Promise<unknown> {
    return this.request('POST', `${this.rightsObjectPath(objectType, objectId)}/rights/bulk`, data);
  }

  // Custom field operations
  createCustomField(fields: object): Promise<unknown> {
    return this.request('POST', 'customfield', fields);
  }

  addCustomFieldValue(cfId: number, fields: object): Promise<unknown> {
    return this.request('POST', `customfield/${seg(cfId)}/value`, fields);
  }

  addCustomFieldValues(cfId: number, values: object[]): Promise<unknown> {
    return this.request('POST', `customfield/${seg(cfId)}/value`, values);
  }

  applyCustomField(cfId: number, objectId: number): Promise<unknown> {
    return this.request('POST', `customfield/${seg(cfId)}/appliesto`, { ObjectId: objectId });
  }

  removeCustomFieldApplication(cfId: number, objectId: number): Promise<unknown> {
    return this.request('DELETE', `customfield/${seg(cfId)}/appliesto/object/${seg(objectId)}`);
  }

  listCustomFieldApplications(cfId: number, opts: { per_page?: number; page?: number } = {}): Promise<unknown> {
    return this.request('GET', `customfield/${seg(cfId)}/appliesto`, undefined, {
      per_page: opts.per_page,
      page: opts.page,
    });
  }

  // Group operations
  listGroups(fields?: string): Promise<unknown> {
    return this.request('GET', 'groups', undefined, { fields: fields ?? DEFAULT_FIELDS.groups });
  }

  getGroup(idOrName: string): Promise<unknown> {
    return this.request('GET', `group/${seg(idOrName)}`);
  }

  createGroup(fields: Record<string, unknown>): Promise<unknown> {
    return this.request('POST', 'group', fields);
  }

  listGroupMembers(id: string, opts: { recursively?: boolean; users?: boolean; groups?: boolean; per_page?: number; page?: number } = {}): Promise<unknown> {
    const params: Record<string, string | number | undefined> = {
      per_page: opts.per_page,
      page: opts.page,
    };
    if (opts.recursively) params.recursively = 1;
    if (opts.users) params.users = 1;
    if (opts.groups) params.groups = 1;
    return this.request('GET', `group/${seg(id)}/members`, undefined, params);
  }

  addGroupMembers(id: string, memberIds: number[]): Promise<unknown> {
    return this.request('PUT', `group/${seg(id)}/members`, memberIds);
  }

  removeGroupMember(groupId: string, memberId: string): Promise<unknown> {
    return this.request('DELETE', `group/${seg(groupId)}/member/${seg(memberId)}`);
  }

  searchCustomFields(query: object[], opts: { fields?: string; per_page?: number; page?: number } = {}): Promise<unknown> {
    return this.request('POST', 'customfields', query, {
      fields: opts.fields ?? DEFAULT_FIELDS.customFields,
      per_page: opts.per_page,
      page: opts.page,
    });
  }
}
