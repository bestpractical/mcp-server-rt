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
