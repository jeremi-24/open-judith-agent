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
  // false: Judith takes a screenshot only when the question needs it.
  alwaysLook: false,
  // After answering, listen again for a few seconds (a real conversation).
  conversation: true,
  // Drawing on the screen: "helpful" (only when it saves searching), "none", "always".
  annotations: 'helpful',
  // Listen to the microphone as soon as Judith is summoned.
  voiceInput: true,
  speechModel: 'onnx-community/whisper-base',
  // Cloud listening, like HeyClicky (your own key, https://deepgram.com):
  // "deepgram" streams your voice and shows words as you speak. "whisper" stays local.
  speechInput: 'whisper',
  deepgramKey: '',
  deepgramModel: 'nova-3',
  // Judith's voice: a local neural voice, or "windows" for the system voices.
  // "elevenlabs" = premium cloud voice (your own key, https://elevenlabs.io).
  voice: 'siwis',
  elevenlabsKey: '',
  elevenlabsVoice: '21m00Tcm4TlvDq8ikWAM',
  elevenlabsModel: 'eleven_flash_v2_5',
  // "fish" = Fish Audio (your own key, https://fish.audio); fishVoice = a voice id
  // (reference_id) from their library, ideally a French one.
  fishKey: '',
  fishVoice: '',
  fishModel: 's2.1-pro-free',
  voiceSpeed: 1.05,
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
