// Local HTTP bridge between Judith's MCP server (started by Claude Code) and
// the app: screenshots and visuals go through it.
// Listens on 127.0.0.1 only, and every call must carry a random token.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

export function startBridge({ onVisual, onLook, onScene }) {
  const token = randomBytes(24).toString('hex');
  const routes = {
    '/look': () => onLook(),
    '/visual': async ({ title, html }) => {
      onVisual(String(title ?? ''), String(html ?? ''));
      return { ok: true };
    },
    // A 3D scene: answers once the board ran the code (or gave up).
    '/scene': ({ title, code }) => onScene(String(title ?? ''), String(code ?? '')),
  };

  const server = createServer(async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${token}`) return reply(401, { error: 'unauthorized' });
    const route = req.method === 'POST' && routes[req.url];
    if (!route) return reply(404, { error: 'not found' });

    let raw = '';
    for await (const chunk of req) raw += chunk;
    try {
      reply(200, await route(JSON.parse(raw)));
    } catch {
      reply(400, { error: 'bad request' });
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}`, token, close: () => server.close() });
    });
  });
}
