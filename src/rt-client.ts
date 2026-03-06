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

export interface SearchOptions {
  orderby?: string;
  order?: 'ASC' | 'DESC';
  per_page?: number;
  page?: number;
  fields?: string;
}

export interface HistoryOptions {
  per_page?: number;
  page?: number;
  fields?: string;
}

export interface UserSearchOptions {
  per_page?: number;
  page?: number;
}

export interface QueueFieldsResult {
  id: number;
  Name: string;
  Lifecycle: string;
  CustomFields: unknown[];
}

export interface GetTicketOptions {
  fields?: string;
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
  Priority?: number;
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
  Priority?: number;
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
  // Link relationships (set, add, or remove)
  RefersTo?: LinkValue;
  ReferredToBy?: LinkValue;
  DependsOn?: LinkValue;
  DependedOnBy?: LinkValue;
  Parent?: LinkValue;
  Child?: LinkValue;
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
}

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

function convertDates(fields: Record<string, unknown>): Record<string, unknown> {
  const result = { ...fields };
  for (const key of DATE_FIELDS) {
    if (typeof result[key] === 'string') {
      result[key] = localToUTC(result[key] as string);
    }
  }
  return result;
}

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

  // Rewrite REST API ticket URLs to web UI URLs so Claude presents clickable
  // links like /Ticket/Display.html?id=123 instead of /REST/2.0/ticket/123.
  private rewriteUrls(data: unknown): unknown {
    if (typeof data === 'string') {
      const prefix = `${this.url}/REST/2.0/ticket/`;
      if (data.startsWith(prefix)) {
        const rest = data.slice(prefix.length);
        const id = rest.split('/')[0];
        if (id && !isNaN(Number(id))) {
          return `${this.url}/Ticket/Display.html?id=${id}`;
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
  ): Promise<unknown> {
    const url = new URL(`${this.url}/REST/2.0/${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
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
      fields: opts.fields,
    });
  }

  getTicket(id: number, opts: GetTicketOptions = {}): Promise<unknown> {
    return this.request('GET', `ticket/${id}`, undefined, {
      fields: opts.fields,
    });
  }

  createTicket(fields: CreateTicketFields): Promise<unknown> {
    const body = {
      ...convertDates(fields as Record<string, unknown>),
      Attachments: fields.Attachments?.map(resolveAttachment),
    };
    return this.request('POST', 'ticket', body);
  }

  updateTicket(id: number, fields: UpdateTicketFields): Promise<unknown> {
    return this.request('PUT', `ticket/${id}`, convertDates(fields as Record<string, unknown>));
  }

  getTicketHistory(id: number, opts: HistoryOptions = {}): Promise<unknown> {
    return this.request('GET', `ticket/${id}/history`, undefined, {
      per_page: opts.per_page,
      page: opts.page,
      fields: opts.fields,
    });
  }

  ticketComment(id: number, fields: MessageFields): Promise<unknown> {
    const body = { ...fields, Attachments: fields.Attachments?.map(resolveAttachment) };
    if (body.Content !== undefined && body.ContentType === undefined) body.ContentType = 'text/plain';
    return this.request('POST', `ticket/${id}/comment`, body);
  }

  ticketCorrespond(id: number, fields: MessageFields): Promise<unknown> {
    const body = { ...fields, Attachments: fields.Attachments?.map(resolveAttachment) };
    if (body.Content !== undefined && body.ContentType === undefined) body.ContentType = 'text/plain';
    return this.request('POST', `ticket/${id}/correspond`, body);
  }

  // Attachment operations

  getTicketAttachments(id: number, opts: HistoryOptions = {}): Promise<unknown> {
    return this.request('GET', `ticket/${id}/attachments`, undefined, {
      per_page: opts.per_page,
      page: opts.page,
    });
  }

  async getAttachment(id: number): Promise<unknown> {
    const a = (await this.request('GET', `attachment/${id}`)) as {
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
    const a = (await this.request('GET', `attachment/${id}`)) as {
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
    return this.request('GET', `queue/${idOrName}`);
  }

  listQueues(fields: string | undefined = 'Name,Description,Lifecycle,Disabled,SubjectTag,CorrespondAddress,CommentAddress'): Promise<unknown> {
    return this.request('GET', 'queues/all', undefined, { fields });
  }

  // Current user

  async getCurrentUser(): Promise<unknown> {
    const userId = this.token.split('-')[1];
    if (!userId || isNaN(Number(userId))) {
      throw new Error('Could not determine user ID from RT token format');
    }
    const user = (await this.request('GET', `user/${userId}`)) as Record<string, unknown>;
    const keep = ['id', 'Name', 'RealName', 'EmailAddress', 'Organization', 'Lang', 'Timezone', 'Privileged', 'Disabled'];
    return Object.fromEntries(keep.filter((k) => k in user).map((k) => [k, user[k]]));
  }

  // Transaction operations

  async getTransaction(id: number): Promise<unknown> {
    const txn = (await this.request('GET', `transaction/${id}`)) as {
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
      attachmentRefs.map((id) => this.request('GET', `attachment/${id}`)),
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

  lookupUser(query: string, opts: UserSearchOptions = {}): Promise<unknown> {
    const queryArray = [
      { field: 'Name', operator: 'LIKE', value: query },
      { field: 'EmailAddress', operator: 'LIKE', value: query, entry_aggregator: 'OR' },
    ];
    return this.request('POST', 'users', queryArray, {
      per_page: opts.per_page,
      page: opts.page,
    });
  }

  async getQueueFields(idOrName: string): Promise<QueueFieldsResult> {
    const queue = (await this.request('GET', `queue/${idOrName}`)) as {
      id: number;
      Name: string;
      Lifecycle: string;
      TicketCustomFields?: Array<{ id: number; _url?: string }>;
    };

    const cfRefs = queue.TicketCustomFields ?? [];
    const results = await Promise.allSettled(
      cfRefs.map((cf) => this.request('GET', `customfield/${cf.id}`)),
    );
    const customFields = results
      .filter((r): r is PromiseFulfilledResult<unknown> => r.status === 'fulfilled')
      .map((r) => r.value);

    return {
      id: queue.id,
      Name: queue.Name,
      Lifecycle: queue.Lifecycle,
      CustomFields: customFields,
    };
  }
}
