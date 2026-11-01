import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULTS = {
  workingDirectory: homedir(),
  claudePath: null,
  model: 'haiku',
  language: 'fr',
  shortcut: 'Control+Alt+J',
  mode: 'show',
};

export const configPath = () => join(app.getPath('userData'), 'config.json');

export function loadConfig() {
  const path = configPath();
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(DEFAULTS, null, 2)}\n`);
    return { ...DEFAULTS };
  }
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(path, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}
