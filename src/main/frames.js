// judith-frame:// — where the board's sandboxed frames come from.
//
// What the model writes (an HTML visual, the code of a 3D scene) runs in a
// frame with sandbox="allow-scripts". Such a frame has an opaque origin: it
// may not load file:// pages or scripts, and a srcdoc frame inherits the
// board's own CSP (which blocks every inline script). Served from this scheme
// instead, each frame gets its own CSP, sent as a header:
//   judith-frame://visual/<id>      an HTML visual (inline scripts allowed, no network)
//   judith-frame://scene/<file>     the 3D scene frame and its scripts (fixed list)
// Nothing else answers: no path from the request ever reaches the disk.
import { join } from 'node:path';

export const FRAME_SCHEME = 'judith-frame';

export const VISUAL_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:";
// 'unsafe-eval': the scene's code is the model's, run with new Function; it
// can reach nothing (no network, opaque origin, no access to Judith).
export const SCENE_CSP = "default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:";

const SCENE_FILES = {
  'scene.html': ['src/renderer/scene.html', 'text/html; charset=utf-8'],
  'scene-boot.js': ['src/renderer/scene-boot.js', 'text/javascript; charset=utf-8'],
  'scene-bricks.js': ['src/renderer/scene-bricks.js', 'text/javascript; charset=utf-8'],
  'scene-runtime.js': ['src/renderer/scene-runtime.js', 'text/javascript; charset=utf-8'],
  'three.min.js': ['node_modules/three/build/three.min.js', 'text/javascript; charset=utf-8'],
};

// Visuals report their height so the board can fit the frame to them.
export const FIT = `<script>
new ResizeObserver(() => parent.postMessage({ judithHeight: document.documentElement.scrollHeight }, '*'))
  .observe(document.documentElement);
</script>`;

// The last visuals, by id (a few: the board shows one at a time).
export function createVisualStore(limit = 8) {
  const items = new Map();
  let next = 0;
  return {
    add(html) {
      const id = String(++next);
      items.set(id, String(html));
      while (items.size > limit) items.delete(items.keys().next().value);
      return `${FRAME_SCHEME}://visual/${id}`;
    },
    get: (id) => items.get(id),
  };
}

// url → { status, type, csp, body } or { status, type, csp, file } (a path
// under root, from the fixed list only).
export function resolveFrame(url, { root, visuals }) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { status: 400 };
  }
  if (parsed.protocol !== `${FRAME_SCHEME}:`) return { status: 404 };
  const name = parsed.pathname.replace(/^\/+/, '');
  if (parsed.host === 'visual') {
    const html = visuals.get(name);
    if (html == null) return { status: 404 };
    return { status: 200, type: 'text/html; charset=utf-8', csp: VISUAL_CSP, body: `${html}${FIT}` };
  }
  if (parsed.host === 'scene' && Object.hasOwn(SCENE_FILES, name)) {
    const [file, type] = SCENE_FILES[name];
    return { status: 200, type, csp: SCENE_CSP, file: join(root, file) };
  }
  return { status: 404 };
}
