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
  // Listen to the microphone as soon as Judith is summoned.
  voiceInput: true,
  speechModel: 'onnx-community/whisper-base',
  // false = Judith shows up in screen recordings (handy to film demos).
  hideFromScreenRecordings: true,
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
  } catch (error) {
    // A common cause on Windows: single backslashes in paths (use \\ or /).
    console.error(`[judith] ${path} is not valid JSON, using defaults: ${error.message}`);
    return { ...DEFAULTS };
  }
}
