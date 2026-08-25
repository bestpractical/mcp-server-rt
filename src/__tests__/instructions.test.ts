import { describe, it, expect } from 'vitest';
import { buildInstructions } from '../instructions.js';
import { CONTENT_FORMATS } from '../rt-client.js';

const instructions = buildInstructions({
  rtUrl: 'http://rt.example.com',
  timezone: 'America/Los_Angeles',
});

describe('buildInstructions', () => {
  it('includes the RT web UI base URL so the AI links to the UI, not the REST API', () => {
    expect(instructions).toContain('http://rt.example.com/Ticket/Display.html?id=TICKET_ID');
  });

  it('includes the resolved timezone', () => {
    expect(instructions).toContain('America/Los_Angeles');
  });

  // search_tickets sends a default field set and both fields and subfields
  // replace it outright rather than merging with it. An AI that reads them as
  // additive asks for one field and loses the rest of the row — the id-only
  // results the default set exists to prevent.
  describe('ticket display guidance', () => {
    it('says fields and subfields replace the default rather than adding to it', () => {
      const clause = instructions.match(/[^.]*replaces the default[^.]*/i)?.[0] ?? '';

      expect(clause).toMatch(/\bfields\b/);
      expect(clause).toMatch(/\bsubfields\b/);
    });

    // Knowing the default is replaced is only useful with the consequence: a
    // narrowed set has to name every field it keeps, not just the ones added.
    it('tells the AI to list every field it still wants', () => {
      expect(instructions).toMatch(/list every field/i);
    });
  });

  // Description and HTML custom fields render markup raw, so a bare newline
  // shows nothing, while other fields display the value as typed.
  describe('content formatting guidance', () => {
    it('says the Description field is HTML', () => {
      expect(instructions).toMatch(/Description[^.]*is HTML/i);
    });

    it('points at the per-field ContentFormat hint', () => {
      expect(instructions).toContain('ContentFormat');
      expect(instructions).toContain('get_queue_fields');
    });

    // The instructions used to promise the AI never needs to escape anything.
    // RT escapes a bare "<" in running text, but it deletes anything that
    // parses as a tag it does not allow, along with the text inside it — so an
    // unescaped <bob@example.com> disappears with no error.
    it('warns that RT deletes a tag it does not recognise', () => {
      expect(instructions).toMatch(/delete[^.]*tag/i);
    });

    it('shows the escaped form to use for angle brackets that are not markup', () => {
      expect(instructions).toContain('&lt;');
    });

    it('says RT does not double-escape an entity that is already escaped', () => {
      expect(instructions).toMatch(/double-escape/i);
    });

    // get_queue_fields can report any of these, so an AI reading one needs to
    // find it described here rather than guess.
    it.each([...new Set([...Object.values(CONTENT_FORMATS), 'plain-text'])])(
      'describes the %s content format',
      (format) => {
        expect(instructions).toContain(`"${format}"`);
      },
    );
  });

  // RT resolves priority labels itself and treats one it cannot find as 0, the
  // lowest priority, reporting success either way. The server has no way to
  // detect that, so the AI has to be told to verify from what RT reports back
  // rather than assume the label it sent is the one that landed.
  describe('priority guidance', () => {
    it('warns that an unrecognized label silently becomes the lowest priority', () => {
      expect(instructions).toMatch(/PRIORITY:/);
      expect(instructions).toMatch(/does not reject/i);
      expect(instructions).toMatch(/reports success/i);
    });

    it('points the AI at the change RT reports rather than the label it sent', () => {
      expect(instructions).toMatch(/Priority changed from X to Y/);
      expect(instructions).toContain('PrioritySet');
    });
  });

  // update_ticket refuses bare link relations because RT treats them as "these
  // are now the only links of this type". The AI needs to know that before it
  // tries one, not from the resulting error.
  describe('ticket link guidance', () => {
    it('names the incremental link fields', () => {
      expect(instructions).toContain('AddRefersTo');
      expect(instructions).toContain('DeleteRefersTo');
    });

    it('warns the AI off bare link relations on update_ticket', () => {
      expect(instructions).toMatch(/bare relation/i);
    });

    it('says how to replace a link', () => {
      expect(instructions).toMatch(/delete the old .* add the new/i);
    });

    // Deleting a link means naming it, so the AI has to be able to list the
    // ones a ticket already has. They arrive under a "ref" whose name is not
    // the name of the field that sets them.
    it('says where a ticket\'s existing links can be read', () => {
      expect(instructions).toMatch(/_hyperlinks of a get_ticket response/);
      expect(instructions).toContain('"refers-to"');
      expect(instructions).toContain('"parent"');
      expect(instructions).toContain('"child"');
    });
  });

  describe('reminder status guidance', () => {
    // The instructions used to say a reminder's active status is "open".
    // The status a reminder starts in is set by the queue lifecycle —
    // on_create for the ones this server creates through the ticket API, "new"
    // in RT's default lifecycle — so Status = 'open' matched nothing and the AI
    // reported that the user had no reminders.
    it('requires the __Active__ meta-value for finding outstanding reminders', () => {
      expect(instructions).toContain("Status = '__Active__'");
    });

    it('gives the __Inactive__ meta-value for completed reminders', () => {
      expect(instructions).toContain("Status = '__Inactive__'");
    });

    // The durable form of the bug: any Status comparison handed to the AI as a
    // query must use a meta-value, because every literal status name in RT is
    // configurable per lifecycle.
    it('never compares Status against a literal status name', () => {
      const compared = [...instructions.matchAll(/Status\s*=\s*'([^']+)'/g)].map((m) => m[1]);

      expect(compared.length).toBeGreaterThan(0);
      for (const status of compared) {
        expect(status).toMatch(/^__(?:Active|Inactive)__$/);
      }
    });

    it('never describes the active state as one literally named status', () => {
      expect(instructions).not.toMatch(/active status is "[a-z]+"/i);
    });

    it('explains that the starting status comes from the queue lifecycle', () => {
      expect(instructions).toContain('on_create');
      expect(instructions).toContain('reminder_on_open');
    });
  });
});
