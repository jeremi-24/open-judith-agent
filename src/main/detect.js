// Is Claude Code installed on this PC? Asked at start, and again when the
// settings open (the user may have installed it since).
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const onPath = (command) =>
  new Promise((resolve) => {
    const finder = process.platform === 'win32' ? 'where.exe' : 'which';
    execFile(finder, [command], { windowsHide: true, timeout: 4000 }, (error) => resolve(!error));
  });

// claudePath: the path set in config.json, if any.
export async function detectClaude(claudePath) {
  if (claudePath && existsSync(claudePath)) return true;
  const native = join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
  return existsSync(native) || onPath('claude');
}
