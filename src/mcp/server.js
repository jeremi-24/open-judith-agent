// Judith's eyes and visuals: an MCP server that Claude Code starts next to
// itself. It has two tools, and neither acts on the computer: look at the
// screen, and show a visual explanation next to it.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BRIDGE = process.env.JUDITH_BRIDGE;
const TOKEN = process.env.JUDITH_TOKEN;

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

const server = new McpServer({ name: 'judith', version: '0.2.0' });

// Judith looks only when it helps: no screenshot for "what is a closure",
// one for "where is the export button" or "explain what I see".
server.registerTool(
  'look_at_screen',
  {
    description:
      "Take a screenshot of the user's screen. Call it when the answer depends on what is on the screen " +
      '(where is X, what is this, help me with this app or page, explain what I see, the next step on this page). ' +
      'Do not call it for general questions. Call it again when the screen may have changed.',
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

await server.connect(new StdioServerTransport());
