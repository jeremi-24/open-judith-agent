// Local HTTP bridge between Judith's MCP server (started by Claude Code) and
// the app: it lets the MCP server ask the user for permission in the notch.
// Listens on 127.0.0.1 only, and every call must carry a random token.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

export function startBridge({ onApprove }) {
  const token = randomBytes(24).toString('hex');

  const server = createServer(async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${token}`) return reply(401, { error: 'unauthorized' });
    if (req.method !== 'POST' || req.url !== '/approve') return reply(404, { error: 'not found' });

    let raw = '';
    for await (const chunk of req) raw += chunk;
    try {
      const { tool, input } = JSON.parse(raw);
      reply(200, { allow: await onApprove(tool, input ?? {}) });
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
