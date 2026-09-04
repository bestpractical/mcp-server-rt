import { readFileSync } from 'fs';
import { dataFile } from './data-files.js';

export interface PromptDef {
  name: string;
  title: string;
  description: string;
  content: string;
}

function loadPrompts(): PromptDef[] {
  const prompts: PromptDef[] = [];
  try {
    const createQueue = readFileSync(dataFile('prompts', 'create-queue.md'), 'utf-8');
    prompts.push({
      name: 'create-queue',
      title: 'Create a Queue',
      description:
        'Interactive workflow consultant that helps RT admins design and create ' +
        'a new queue — discovers the workflow, recommends configuration, then ' +
        'executes the setup using RT tools.',
      content: createQueue,
    });
  } catch {
    // Prompt file not found — not fatal, just no prompts available.
  }
  return prompts;
}

export const PROMPTS = loadPrompts();
