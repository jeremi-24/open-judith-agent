// The "eyes" companion (companions/eyes, .NET Framework 4.8): asks Windows UI
// Automation which controls are around a point, with their exact bounds.
// Started once, kept running, one line per question. Optional: without it
// (not built, not Windows, crashed twice) marks keep the model's position.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createLineParser } from '../core/stream.js';

// Installed app: companions/judith-eyes.exe; from source: the build output.
export function findEyes(root) {
  return [join(root, 'companions', 'judith-eyes.exe'), join(root, 'companions', 'eyes', 'bin', 'Release', 'net48', 'judith-eyes.exe')].find((p) => existsSync(p)) ?? null;
}

// exe: the companion's path (or a test double); timeoutMs: a mark never waits
// longer than this for its snap.
export function createEyes({ exe, args = [], timeoutMs = 300, spawnImpl = spawn, log = () => {} }) {
  let proc = null;
  let crashes = 0;
  let nextId = 1;
  const waiting = new Map();

  function start() {
    if (proc || !exe || crashes >= 2) return proc;
    proc = spawnImpl(exe, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    proc.stdout.setEncoding('utf8');
    proc.stdout.on(
      'data',
      createLineParser((reply) => {
        const pending = waiting.get(String(reply.id));
        if (!pending) return;
        waiting.delete(String(reply.id));
        clearTimeout(pending.timer);
        pending.resolve(reply.error ? null : (reply.elements ?? null));
      }),
    );
    proc.stderr.on('data', (text) => log(String(text).trim()));
    const gone = (why) => {
      log(`eyes stopped (${why})`);
      crashes += 1;
      proc = null;
      for (const [id, pending] of waiting) {
        clearTimeout(pending.timer);
        pending.resolve(null);
        waiting.delete(id);
      }
    };
    proc.on('error', (error) => gone(error.message));
    // Writing to a companion that just died (EPIPE) must not crash Judith.
    proc.stdin.on('error', (error) => log(`stdin: ${error.message}`));
    proc.on('exit', (code) => gone(`exit ${code}`));
    return proc;
  }

  return {
    get available() {
      return Boolean(exe) && crashes < 2;
    },
    // Physical screen pixels → [{ name, type, x, y, w, h }] or null.
    around(x, y) {
      if (!start()) return Promise.resolve(null);
      const id = String(nextId++);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiting.delete(id);
          resolve(null);
        }, timeoutMs);
        waiting.set(id, { resolve, timer });
        proc.stdin.write(`around ${id} ${Math.round(x)} ${Math.round(y)}\n`);
      });
    },
    stop() {
      proc?.kill();
      proc = null;
    },
  };
}
