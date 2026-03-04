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

export interface CreateTicketFields {
  Queue: string;
  Subject: string;
  Content?: string;
  ContentType?: 'text/plain' | 'text/html';
  Priority?: number;
  Owner?: string;
  Requestor?: string;
  Cc?: string;
  AdminCc?: string;
  CustomFields?: Record<string, unknown>;
}

export interface UpdateTicketFields {
  Subject?: string;
  Status?: string;
  Priority?: number;
  Owner?: string;
  Queue?: string;
  CustomFields?: Record<string, unknown>;
}

export interface MessageFields {
  Content: string;
  ContentType?: 'text/plain' | 'text/html';
  TimeTaken?: number;
  Status?: string;
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

    return response.json();
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
    return this.request('POST', 'ticket', fields);
  }

  updateTicket(id: number, fields: UpdateTicketFields): Promise<unknown> {
    return this.request('PUT', `ticket/${id}`, fields);
  }

  getTicketHistory(id: number, opts: HistoryOptions = {}): Promise<unknown> {
    return this.request('GET', `ticket/${id}/history`, undefined, {
      per_page: opts.per_page,
      page: opts.page,
      fields: opts.fields,
    });
  }

  ticketComment(id: number, fields: MessageFields): Promise<unknown> {
    return this.request('POST', `ticket/${id}/comment`, fields);
  }

  ticketCorrespond(id: number, fields: MessageFields): Promise<unknown> {
    return this.request('POST', `ticket/${id}/correspond`, fields);
  }

  // Queue operations

  getQueue(idOrName: string): Promise<unknown> {
    return this.request('GET', `queue/${idOrName}`);
  }

  listQueues(): Promise<unknown> {
    return this.request('GET', 'queues/all');
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
