import { describe, it, expect, vi } from 'vitest';
import { PROMPTS } from '../prompts.js';
import { dataFile } from '../data-files.js';

describe('dataFile', () => {
  it('resolves under the bundled data directory', () => {
    expect(dataFile('ticketsql_grammar.md')).toMatch(/[/\\]data[/\\]ticketsql_grammar\.md$/);
  });

  it('joins nested paths', () => {
    expect(dataFile('prompts', 'create-queue.md')).toMatch(
      /[/\\]data[/\\]prompts[/\\]create-queue\.md$/,
    );
  });
});

describe('PROMPTS', () => {
  // loadPrompts swallows a read failure, so a packaging mistake that drops
  // data/prompts would surface as a server advertising no prompts rather than
  // as an error. These assertions are the thing that would catch it.
  it('loads the create-queue prompt', () => {
    expect(PROMPTS.map((p) => p.name)).toEqual(['create-queue']);
  });

  it('gives every prompt a title and description for the client to show', () => {
    for (const p of PROMPTS) {
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
    }
  });

  it('reads the prompt body from disk, not an empty placeholder', () => {
    const [createQueue] = PROMPTS;
    expect(createQueue.content.length).toBeGreaterThan(1000);
    expect(createQueue.content).toContain('## Discovery');
    expect(createQueue.content).toContain('Steps to Execute');
  });

  it('yields no prompts when the file cannot be read, rather than throwing', async () => {
    vi.resetModules();
    vi.doMock('fs', () => ({
      readFileSync: () => {
        throw new Error('ENOENT: no such file or directory');
      },
    }));

    const { PROMPTS: withoutFiles } = await import('../prompts.js');
    expect(withoutFiles).toEqual([]);

    vi.doUnmock('fs');
    vi.resetModules();
  });
});
