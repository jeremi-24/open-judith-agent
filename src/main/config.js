import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { detectLanguage } from '../core/i18n.js';

export const DEFAULTS = {
  // Judith thinks with the user's own Claude Code (model and effort below).
  // Judith may act on the computer (edit files, run commands…), not only look and explain.
  claudeActs: true,
  // Agent mode, autonomous ("Agent autonome, …"): Judith may click and type
  // herself, within the guardrails (src/core/guard.js). On by default, when the companion is installed.
  agentHands: true,
  workingDirectory: homedir(),
  claudePath: null,
  model: 'haiku',
  // How much Claude thinks before answering: "low" is fast, right for a conversation.
  effort: 'low',
  language: 'fr',
  shortcut: 'Control+Alt+J',
  // Summon Judith and draw the zone of the screen to explain first.
  zoneShortcut: 'Control+Alt+Shift+J',
  // Open what Claude creates to explain (an artifact, a diagram, a document) in the browser.
  openCreations: true,
  // false: Judith takes a screenshot only when the question needs it.
  alwaysLook: false,
  // After answering, listen again for a few seconds (a real conversation).
  conversation: true,
  // Talk over Judith to interrupt her (she stops and listens).
  interruptions: true,
  // "auto": Judith hears when the question ends. "push": press the shortcut again to
  // send (noisy places: music, people around). Also in the tray menu.
  listenMode: 'auto',
  // Drawing on the screen: "helpful" (only when it saves searching), "none", "always".
  annotations: 'helpful',
  // The notes board next to the screen (off: marks on the screen say enough).
  board: false,
  // One line per question in journal.jsonl (this PC only), to learn how Judith is used.
  journal: true,
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

// Saves some keys, keeping everything else the user wrote in config.json.
export function saveConfig(changes) {
  const path = configPath();
  let current = {};
  try {
    current = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    current = { ...DEFAULTS };
  }
  writeFileSync(path, `${JSON.stringify({ ...current, ...changes }, null, 2)}\n`);
}

export function loadConfig() {
  const path = configPath();
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    // First start: Judith speaks the language of Windows (French, else English).
    const first = { ...DEFAULTS, language: detectLanguage(Intl.DateTimeFormat().resolvedOptions().locale) };
    writeFileSync(path, `${JSON.stringify(first, null, 2)}\n`);
    return first;
  }
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(path, 'utf8')) };
  } catch (error) {
    // A common cause on Windows: single backslashes in paths (use \\ or /).
    console.error(`[judith] ${path} is not valid JSON, using defaults: ${error.message}`);
    return { ...DEFAULTS };
  }
}
