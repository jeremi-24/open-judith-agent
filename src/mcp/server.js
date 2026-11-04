// Judith's eyes and visuals: an MCP server that Claude Code starts next to
// itself. Its tools never act on the computer: look at the screen, and show a
// visual explanation (HTML or a 3D scene) next to it.
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

// A schematic 3D model next to the screen, built by the model's own code with
// Judith's bricks. The code runs in a sandboxed frame without network; the tool
// says whether it worked, so a broken scene can be fixed once or given up.
server.registerTool(
  'show_scene',
  {
    description:
      'Show a schematic 3D model next to the screen, to explain how a physical or spatial thing works ' +
      '(an engine, a machine, an organ, a building, a molecule, a network of parts). Not for things a flat diagram or marks explain well.\n' +
      'Give JavaScript (no imports, no network, no DOM) that builds the scene. It receives THREE (three.js r159), J (bricks) and stage:\n' +
      "- J.assembly(stage, [{ name, shape: 'cylinder'|'cone'|'disc'|'sphere'|'ring'|'box', radius, radiusEnd (cone), length, height, depth, color, opacity }], { axis: 'x'|'y', gap }) " +
      '→ { group, parts, axis }: parts laid end to end along the axis, labelled with their names, coloured from the palette.\n' +
      "- J.flow(stage, [x,y,z], [x,y,z], { colors: ['sky','blush'], count, speed, spread }): particles flowing (air, fuel, data, blood), changing colour on the way.\n" +
      '- J.explode(stage, assembly, 0..1): pull the parts apart to show the inside.\n' +
      "- J.material(color, { opacity }), J.geometry(part), J.palette (iris, sky, mint, lemon, blush, deep, ink, pearl).\n" +
      '- stage.add(object3D), stage.label(object, text), stage.onFrame((t, dt) => {}) to animate (t, dt in seconds), stage.focus(object).\n' +
      '- stage.steps([{ target: part, text }]): the parts one by one (highlight and camera). In your script lines, write "scene <n>" right before ' +
      'the sentence about step n, so the model follows your voice.\n' +
      'Keep it schematic and light: at most ~12 parts, sizes around 1 to 10 units, centred on 0. Labels in the user language, at most 3 words.',
    inputSchema: { title: z.string(), code: z.string() },
  },
  async ({ title, code }) => {
    const result = await bridge('/scene', { title, code });
    if (result?.ok) return text('The 3D scene is on screen.');
    return text(
      `The 3D scene failed: ${result?.error ?? 'no answer from Judith'}. ` +
        'Fix the code and call show_scene once more, or explain with words and marks on the screen instead.',
    );
  },
);

await server.connect(new StdioServerTransport());
