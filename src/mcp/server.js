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
    // Several zones: one image each, numbered; otherwise one image.
    const images = shot.images?.length ? shot.images : [{ data: shot.data, mediaType: shot.mediaType }];
    const several = images.length > 1;
    const content = images.flatMap((image, i) => [
      ...(several ? [{ type: 'text', text: `Zone ${i + 1}:` }] : []),
      { type: 'image', data: image.data, mimeType: image.mediaType },
    ]);
    const note = several
      ? `These ${images.length} images are ${images.length} zones of the screen the user selected, numbered in the order he drew them. ` +
        'Coordinates you give are fractions of the zone image they point at: write the line "zone <n>" before the drawing lines about zone n.'
      : (shot.zone
          ? 'This is the zone of the screen the user selected (not the whole screen). Coordinates you give are fractions of this image.'
          : 'This is the user screen now. Coordinates you give are fractions of this image.') +
        (shot.pointer ? ` The mouse pointer is at x=${shot.pointer.x.toFixed(3)} y=${shot.pointer.y.toFixed(3)}: "ça"/"this" is what is under it.` : '');
    return { content: [...content, { type: 'text', text: note }] };
  },
);

server.registerTool(
  'show_visual',
  {
    description:
      'Show a rich visual explanation next to the screen: a diagram, timeline, comparison, chart, mind map, annotated schema… ' +
      'Give a complete, self-contained HTML page (inline CSS and SVG, optional inline JS, no external files or network). ' +
      'Let it flow: no fixed width or height. The panel adapts to the content (300 to 760 px wide, as tall as needed), so a wide table or diagram is fine. Light background, clear labels in the user language.',
    inputSchema: { title: z.string(), html: z.string() },
  },
  async ({ title, html }) => {
    await bridge('/visual', { title, html });
    return text('The visual is on screen.');
  },
);

// A 3D model next to the screen, built by the model's own code with Judith's bricks.
// It builds up part by part while she explains. The code runs in a sandboxed frame
// without network; the tool says whether it worked, so a broken scene can be fixed
// once or given up.
server.registerTool(
  'show_scene',
  {
    description:
      'Show a 3D model next to the screen that BUILDS UP part by part while you explain, for anything physical or spatial ' +
      '(a machine, an organ, a building, a vehicle, a molecule, a landscape, a mechanism…). You decide what to model and how. ' +
      'Not for things a flat diagram or marks explain well.\n' +
      'LESS IS MORE: it is a clean sketch to understand with, not a replica. AT MOST 8 parts, in at most 5 steps (one per sentence you will say). Big simple shapes; merge details into one shape ' +
      '(a car is a body, a cabin and wheels: no mirrors, handles or windows). Name only the 4 to 6 parts you will talk about: a part without a name gets no label, so decor stays quiet.\n' +
      'Give JavaScript (no imports, no network, no DOM) that builds the scene. It receives THREE (three.js r159), J (bricks) and stage. y is up, one unit is about a hand.\n' +
      '- J.build(stage, parts): the main brick. parts is a list of { name, shape, at: [x, y, z] (the centre), size: [width, height, depth] | radius | height | length, ' +
      "rotate: [rx, ry, rz] (degrees), color, opacity, step }. Shapes: 'box' (size), 'cylinder' (radius, height), 'cone' (radius, height, radiusEnd), 'sphere' (radius), " +
      "'ring' (radius, tube), 'prism' (size: triangle with base width, height, extruded over depth: roofs, ramps, wedges), 'halfcylinder' (radius, length: vaults, arches, tunnels), " +
      "'extrude' (outline: [[x, y], …], depth, smooth: true to curve it, bevel: any flat profile: a wing, a car's side). Colours: iris, sky, mint, lemon, blush, deep, ink, pearl, or any CSS colour.\n" +
      "  SMOOTH shapes look finished, plain boxes look raw: prefer 'lathe' (outline: [[radius, height], …] turned round the y axis: a fuselage, bottle, dome, tower, tree trunk; lay it flat with rotate [0, 0, 90]), " +
      "'ellipsoid' (size [w, h, d]: a body, a head, a hull, a cloud), 'capsule' (radius, length: a limb, a pill, a pod), 'tube' (points: [[x, y, z], …] relative to at, radius: a pipe, cable, vein, handle) " +
      "and 'roundbox' (soft corners). 'box', 'prism' and 'halfcylinder' already have soft edges (round: false for sharp ones).\n" +
      '  Parts appear one step at a time, in order: base and foundations first, details last. Without step numbers each part is a step; with them, parts with the same number appear together ' +
      '(a part without a number joins the one before it). A named part gets a hand-written label with a line to it (at most 3 words).\n' +
      '  In your script lines, write "scene <n>" right before the sentence about step n, for every step, in order: the model follows your voice.\n' +
      '- J.spin(stage, part, { axis, speed }), J.swing(stage, part, { axis, amplitude, speed }), J.move(stage, part, { axis, amount, speed }): make a part turn, rock or slide, to show how it works.\n' +
      "- J.assembly(stage, [{ name, shape: 'cylinder'|'cone'|'disc'|'sphere'|'ring'|'box', radius, length… }], { axis }): parts laid end to end along an axis (engines, pipes, stacks).\n" +
      "- J.flow(stage, [x,y,z], [x,y,z], { colors: ['sky','blush'], count, speed }): particles flowing (air, fuel, data, blood). J.explode(stage, assembly, 0..1): pull the parts apart.\n" +
      '- J.material(color, { opacity }), J.palette, stage.add(object3D), stage.label(object, text), stage.onFrame((t, dt) => {}), stage.focus(object), ' +
      'stage.steps([{ target, text }], { build: true }) for your own steps, stage.reveal(object) / stage.hide(object).',
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
