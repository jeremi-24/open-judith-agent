// Judith's hands: an MCP server that Claude Code starts next to itself.
// It opens apps, websites and folders, and asks the user (through the
// notch) before Claude Code edits a file or runs a command.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { listShortcuts, rankApps } from '../core/apps.js';

const BRIDGE = process.env.JUDITH_BRIDGE;
const TOKEN = process.env.JUDITH_TOKEN;

const START_MENUS = [
  join(process.env.ProgramData ?? 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
];

// Opens a URL, a file, a folder or a shortcut with its default handler.
function launch(target) {
  return new Promise((resolve, reject) => {
    const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', target], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', reject);
    child.on('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

async function bridge(path, body) {
  if (!BRIDGE) return null;
  const response = await fetch(`${BRIDGE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  return response.json();
}

const text = (t) => ({ content: [{ type: 'text', text: t }] });

const server = new McpServer({ name: 'judith', version: '0.1.0' });

server.registerTool(
  'open_app',
  {
    description: 'Open an installed Windows app by name (e.g. "VLC", "Blender", "Word"). Use find_apps first if unsure of the name.',
    inputSchema: { name: z.string().describe('App name as the user says it') },
  },
  async ({ name }) => {
    const [best] = rankApps(listShortcuts(START_MENUS), name);
    if (best) {
      await launch(best.path);
      return text(`Opened ${best.name}.`);
    }
    // Built-in apps without a shortcut ("calc", "notepad", "ms-settings:").
    return new Promise((resolve) => {
      const child = spawn('cmd.exe', ['/d', '/c', 'start', '""', name], { windowsHide: true, stdio: 'ignore' });
      child.on('exit', (code) => resolve(text(code === 0 ? `Asked Windows to start "${name}".` : `No app named "${name}" found.`)));
      child.on('error', () => resolve(text(`No app named "${name}" found.`)));
    });
  },
);

server.registerTool(
  'find_apps',
  {
    description: 'List installed apps whose name matches a query.',
    inputSchema: { query: z.string() },
  },
  async ({ query }) => {
    const apps = rankApps(listShortcuts(START_MENUS), query).slice(0, 10);
    return text(apps.length ? apps.map((a) => a.name).join('\n') : 'No match.');
  },
);

server.registerTool(
  'open_url',
  {
    description: 'Open a website in the default browser.',
    inputSchema: { url: z.string().url() },
  },
  async ({ url }) => {
    if (!/^https?:\/\//i.test(url)) return text('Only http and https links can be opened.');
    await launch(url);
    return text(`Opened ${url}.`);
  },
);

server.registerTool(
  'open_path',
  {
    description: 'Open a folder in Explorer, or a file with its default app.',
    inputSchema: { path: z.string() },
  },
  async ({ path }) => {
    if (!existsSync(path)) return text(`${path} does not exist.`);
    await launch(path);
    return text(`Opened ${path}.`);
  },
);

// Judith looks only when it helps: no screenshot for "open VLC" or "what is
// a closure", one for "where is the export button".
server.registerTool(
  'look_at_screen',
  {
    description:
      "Take a screenshot of the user's screen. Call it when the answer depends on what is on the screen " +
      '(where is X, what is this, help me with this app or page, explain what I see, the next step on this page). ' +
      'Do not call it for general questions, or for actions like opening an app. Call it again when the screen may have changed.',
    inputSchema: {},
  },
  async () => {
    const shot = await bridge('/look', {});
    if (!shot?.data) return text('The screen could not be captured.');
    return {
      content: [
        { type: 'image', data: shot.data, mimeType: shot.mediaType },
        {
          type: 'text',
          text:
            'This is the user screen now. Coordinates you give are fractions of this image.' +
            (shot.pointer ? ` The mouse pointer is at x=${shot.pointer.x.toFixed(3)} y=${shot.pointer.y.toFixed(3)}: "ça"/"this" is what is under it.` : ''),
        },
      ],
    };
  },
);

server.registerTool(
  'show_visual',
  {
    description:
      'Show a rich visual explanation next to the screen: a diagram, timeline, comparison, chart, mind map, annotated schema… ' +
      'Give a complete, self-contained HTML page (inline CSS and SVG, optional inline JS, no external files or network). ' +
      'Design it for a 300 px wide panel, light background, clear labels in the user language.',
    inputSchema: { title: z.string(), html: z.string() },
  },
  async ({ title, html }) => {
    await bridge('/visual', { title, html });
    return text('The visual is on screen.');
  },
);

// Claude Code calls this (--permission-prompt-tool) before any tool that is
// not pre-approved: editing a file, running a command…
server.registerTool(
  'approve',
  {
    description: 'Ask the user to allow or deny a tool call.',
    inputSchema: { tool_name: z.string(), input: z.record(z.string(), z.unknown()), tool_use_id: z.string().optional() },
  },
  async ({ tool_name, input }) => {
    let allowed = false;
    try {
      allowed = (await bridge('/approve', { tool: tool_name, input }))?.allow === true;
    } catch {
      allowed = false;
    }
    const decision = allowed
      ? { behavior: 'allow', updatedInput: input }
      : { behavior: 'deny', message: 'The user said no. Do not retry; tell them in one sentence what you wanted to do.' };
    return text(JSON.stringify(decision));
  },
);

await server.connect(new StdioServerTransport());
