// Which engines are installed on this PC: Claude Code, Codex, Cursor's agent.
// Asked once at start (and again when the settings open).
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ENGINES } from '../engine/engines.js';

const onPath = (command) =>
  new Promise((resolve) => {
    const finder = process.platform === 'win32' ? 'where.exe' : 'which';
    execFile(finder, [command], { windowsHide: true, timeout: 4000 }, (error) => resolve(!error));
  });

export async function detectEngines(claudePath) {
  const found = [];
  for (const [id, engine] of Object.entries(ENGINES)) {
    if (!engine.command) continue;
    if (id === 'claude-code') {
      const native = join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
      if ((claudePath && existsSync(claudePath)) || existsSync(native) || (await onPath('claude'))) found.push(id);
    } else if (await onPath(engine.command)) {
      found.push(id);
    }
  }
  return found;
}
