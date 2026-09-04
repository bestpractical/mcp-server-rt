import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { RTClient } from './rt-client.js';
import { buildInstructions } from './instructions.js';
import { PROMPTS } from './prompts.js';
import { Args, TOOLS, callTool } from './tools.js';
import { version } from '../package.json';

// Validate required environment variables at startup so the user gets a clear
// error before the MCP handshake rather than a cryptic failure on first tool call.
function validateEnv(): void {
  const missing = [];
  if (!process.env.RT_URL) missing.push('RT_URL');
  if (!process.env.RT_TOKEN) missing.push('RT_TOKEN');

  if (missing.length > 0) {
    process.stderr.write(
      `mcp-server-rt: Required environment variable(s) not set: ${missing.join(', ')}\n\n` +
        `Set them in your .mcp.json configuration:\n\n` +
        `  {\n` +
        `    "mcpServers": {\n` +
        `      "rt": {\n` +
        `        "type": "stdio",\n` +
        `        "command": "mcp-server-rt",\n` +
        `        "env": {\n` +
        `          "RT_URL": "http://your-rt.example.com",\n` +
        `          "RT_TOKEN": "your-auth-token"\n` +
        `        }\n` +
        `      }\n` +
        `    }\n` +
        `  }\n\n` +
        `Create an auth token in RT under: Logged in as → Settings → Auth Tokens\n`,
    );
    process.exit(1);
  }
}

validateEnv();

const rt = new RTClient(process.env.RT_URL!, process.env.RT_TOKEN!);
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const server = new Server(
  { name: 'rt', version },
  {
    capabilities: { tools: {}, prompts: {} },
    instructions: buildInstructions({ rtUrl: process.env.RT_URL!, timezone }),
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: PROMPTS.map(({ name, title, description }) => ({
    name,
    title,
    description,
  })),
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name } = request.params;
  const prompt = PROMPTS.find((p) => p.name === name);
  if (!prompt) {
    throw new Error(`Unknown prompt: ${name}`);
  }
  return {
    description: prompt.description,
    messages: [
      {
        role: 'user' as const,
        content: { type: 'text' as const, text: prompt.content },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    const result = await callTool(rt, name, args as Args);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: message }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
server.connect(transport).catch((err: unknown) => {
  process.stderr.write(`mcp-server-rt: Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
