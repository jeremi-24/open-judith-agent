// Judith's hands: an MCP server that Claude Code starts next to itself.
// It opens apps, websites and folders, and asks the user (through the
// notch) before Claude Code edits a file or runs a command.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { isWindowsLink, listShortcuts, mergeApps, rankApps } from '../core/apps.js';

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

// Store apps (Settings, Calculator, WhatsApp…) have no shortcut: Windows
// lists every Start menu app with the id that launches it. Asked once.
let startApps = null;
function listStartApps() {
  startApps ??= new Promise((resolve) => {
    const command = '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress';
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 10000, maxBuffer: 8e6 }, (_error, stdout) => {
      try {
        const list = JSON.parse(stdout);
        resolve((Array.isArray(list) ? list : [list]).map((a) => ({ name: a.Name, appId: a.AppID })));
      } catch {
        startApps = null; // try again next time
        resolve([]);
      }
    });
  });
  return startApps;
}
listStartApps(); // ~2.5 s: ready before the first "ouvre…"
const allApps = async () => mergeApps(listShortcuts(START_MENUS), await listStartApps());

function launchApp(app) {
  if (!app.appId) return launch(app.path);
  return new Promise((resolve, reject) => {
    const child = spawn('explorer.exe', [`shell:AppsFolder\\${app.appId}`], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', reject);
    child.on('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

// A program in the PATH ("notepad", "calc", "mspaint")? Asking Windows to
// start an unknown name would show an error box and block Judith.
const inPath = (name) =>
  new Promise((resolve) => {
    if (!/^[\w.-]+$/.test(name)) return resolve(false);
    execFile('where.exe', [name], { windowsHide: true, timeout: 3000 }, (error) => resolve(!error));
  });

server.registerTool(
  'open_app',
  {
    description:
      'Open an installed Windows app by name (e.g. "VLC", "Paramètres", "WhatsApp", "Calculatrice"), Store apps included. ' +
      'Use find_apps first if unsure of the name. For a Settings page, open_path "ms-settings:…" is more direct.',
    inputSchema: { name: z.string().describe('App name as the user says it') },
  },
  async ({ name }) => {
    if (isWindowsLink(name)) {
      await launch(name.trim());
      return text(`Opened ${name}.`);
    }
    const [best] = rankApps(await allApps(), name);
    if (best) {
      await launchApp(best);
      return text(`Opened ${best.name}.`);
    }
    if (await inPath(name.trim())) {
      spawn(name.trim(), [], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
      return text(`Started ${name}.`);
    }
    return text(`No app named "${name}" found. Try find_apps with another word.`);
  },
);

server.registerTool(
  'find_apps',
  {
    description: 'List installed apps (Store apps included) whose name matches a query.',
    inputSchema: { query: z.string() },
  },
  async ({ query }) => {
    const apps = rankApps(await allApps(), query).slice(0, 10);
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
    description:
      'Open a folder in Explorer, a file with its default app, or a Windows Settings page ' +
      '("ms-settings:bluetooth", "ms-settings:connecteddevices", "ms-settings:display", "ms-settings:sound"…) or a "shell:" folder.',
    inputSchema: { path: z.string() },
  },
  async ({ path }) => {
    if (isWindowsLink(path)) {
      await launch(path.trim());
      return text(`Opened ${path}.`);
    }
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
            (shot.zone
              ? 'This is the zone of the screen the user selected (not the whole screen). Coordinates you give are fractions of this image.'
              : 'This is the user screen now. Coordinates you give are fractions of this image.') +
            (shot.pointer ? ` The mouse pointer is at x=${shot.pointer.x.toFixed(3)} y=${shot.pointer.y.toFixed(3)}: "ça"/"this" is what is under it.` : ''),
        },
      ],
    };
  },
);

// Sharing is the user's move: Judith prepares the image, the user pastes
// and presses send.
server.registerTool(
  'copy_screenshot',
  {
    description:
      'Take a screenshot of the user screen (or of the zone they drew) and put it in the clipboard; it is also saved as a PNG file. ' +
      'Use it when the user wants to send, share or keep a screenshot. Then open the app or site they named (open_app, open_url), ' +
      'look at the screen and mark where to paste: they paste with Ctrl+V and press send themselves. You cannot send messages.',
    inputSchema: {},
  },
  async () => {
    const shot = await bridge('/copy-shot', {});
    if (!shot?.path) return text(`The screenshot could not be taken${shot?.error ? `: ${shot.error}` : ''}.`);
    return text(`Screenshot ${shot.zone ? 'of the selected zone ' : ''}copied to the clipboard (${shot.width}x${shot.height}) and saved to ${shot.path}.`);
  },
);

// Reminders and alarms: Judith keeps them on disk and says them out loud at
// their time, with a Windows notification, even after a restart.
const reminder = (body) => bridge('/reminder', body).catch(() => ({ error: 'Judith could not be reached.' }));
server.registerTool(
  'set_reminder',
  {
    description:
      'Set a reminder or an alarm: at that time Judith says the text out loud and shows a Windows notification. ' +
      'It survives restarts. Use it for every alarm, reminder or timer (never CronCreate or a Windows scheduled task).',
    inputSchema: {
      when: z.string().describe('Local time "17:00" (today, or tomorrow if past) or local date-time "2026-11-02T08:30"'),
      text: z.string().describe('What to remind, in the user language, short (e.g. "Appeler maman")'),
    },
  },
  async ({ when, text: what }) => {
    const r = await reminder({ action: 'set', when, text: what });
    return text(r.error ? `Not set: ${r.error}` : `Reminder set ${r.said} (id ${r.id}): "${r.text}".`);
  },
);

server.registerTool(
  'list_reminders',
  { description: 'List the reminders and alarms Judith keeps.', inputSchema: {} },
  async () => {
    const r = await reminder({ action: 'list' });
    if (r.error) return text(r.error);
    return text(r.reminders.length ? r.reminders.map((x) => `${x.id}: ${x.said} — ${x.text}`).join('\n') : 'No reminder.');
  },
);

server.registerTool(
  'cancel_reminder',
  {
    description: 'Cancel a reminder by its id (from list_reminders), or all of them with "all".',
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const r = await reminder({ action: 'cancel', id });
    return text(r.error ?? `${r.cancelled} reminder(s) cancelled.`);
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
