// The "hands" companion (companions/hands, .NET Framework 4.8): clicks, types,
// presses keys and scrolls through Windows SendInput, for agent mode
// (autonomous) only. Started on the first action, kept running. It decides
// nothing: every action went through src/core/guard.js first.
// If the user moves the mouse, it refuses everything ("user") until reset().
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createLineParser } from '../core/stream.js';

export function findHands(root) {
  return [join(root, 'companions', 'judith-hands.exe'), join(root, 'companions', 'hands', 'bin', 'Release', 'net48', 'judith-hands.exe')].find((p) => existsSync(p)) ?? null;
}

export function createHands({ exe, args = [], spawnImpl = spawn, log = () => {} }) {
  let proc = null;
  let nextId = 1;
  const waiting = new Map();

  function start() {
    if (proc || !exe) return proc;
    proc = spawnImpl(exe, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    proc.stdout.setEncoding('utf8');
    proc.stdout.on(
      'data',
      createLineParser((reply) => {
        const pending = waiting.get(String(reply.id));
        if (!pending) return;
        waiting.delete(String(reply.id));
        clearTimeout(pending.timer);
        pending.resolve(reply);
      }),
    );
    proc.stderr.on('data', (text) => log(String(text).trim()));
    const gone = (why) => {
      log(`hands stopped (${why})`);
      proc = null;
      for (const [id, pending] of waiting) {
        clearTimeout(pending.timer);
        pending.resolve({ error: 'stopped' });
        waiting.delete(id);
      }
    };
    proc.on('error', (error) => gone(error.message));
    proc.on('exit', (code) => gone(`exit ${code}`));
    return proc;
  }

  // One command → its reply ({ ok } / { process, title } / { error }).
  function call(command, args, timeoutMs = 3000) {
    if (!start()) return Promise.resolve({ error: 'unavailable' });
    const id = String(nextId++);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiting.delete(id);
        resolve({ error: 'timeout' });
      }, timeoutMs);
      waiting.set(id, { resolve, timer });
      proc.stdin.write(`${[command, id, ...args].join(' ')}\n`);
    });
  }

  const n = (v) => String(Math.round(v));
  return {
    get available() {
      return Boolean(exe);
    },
    // Physical screen pixels everywhere.
    at: (x, y) => call('at', [n(x), n(y)]),
    foreground: () => call('fg', []),
    click: (x, y, button = 'left') => call('click', [n(x), n(y), ['left', 'right', 'double'].includes(button) ? button : 'left']),
    type: (text) => call('type', [Buffer.from(String(text), 'utf8').toString('base64')], 3000 + String(text).length * 30),
    key: (combo) => call('key', [String(combo).toLowerCase().replace(/\s+/g, '')]),
    scroll: (x, y, notches) => call('scroll', [n(x), n(y), n(notches)]),
    reset: () => call('reset', []),
    stop() {
      proc?.kill();
      proc = null;
    },
  };
}
