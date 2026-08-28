import { join } from 'path';

// Files bundled with the package under data/ — the TicketSQL grammar reference
// and the prompt sources. In the built output (dist/index.js) that directory is
// one level up from the script; running from source resolves the same way,
// because src/ and data/ are siblings under the project root. Both callers go
// through here so the layout assumption is written down once: a reader that
// silently finds nothing is hard to notice, and loadPrompts swallows the error.
const dataDir = join(__dirname, '..', 'data');

export function dataFile(...parts: string[]): string {
  return join(dataDir, ...parts);
}
