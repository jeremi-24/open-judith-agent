// Bridge between Judith's windows and the main process (preloads stay CommonJS).
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = [
  // notch
  'focus', 'idle', 'cancel-all', 'agent', 'agent-next', 'confirm', 'ask', 'cmd', 'answer', 'error', 'tool', 'stale', 'marked', 'speech', 'link',
  // overlay (and the notch, for 'zone')
  'mark', 'clear', 'scan', 'shift', 'select', 'zone', 'piloting',
  // board
  'board', 'note', 'visual', 'scene', 'scene-step', 'activity', 'clear-board',
];

contextBridge.exposeInMainWorld('judith', {
  ask: (question, turn) => ipcRenderer.invoke('judith:ask', question, turn),
  // Stop this turn (X, or the user talks over Judith).
  cancel: (turn) => ipcRenderer.send('judith:cancel', turn),
  clearScreen: () => ipcRenderer.send('judith:clear-screen'),
  // audio: Float32Array, mono 16 kHz → text.
  transcribe: (audio) => ipcRenderer.invoke('judith:transcribe', audio),
  // '' when what was heard is a Whisper phantom or Judith's own echo.
  filterHeard: (text, spoken) => ipcRenderer.invoke('judith:filter-heard', text, spoken),
  // Starts speaking a sentence; its audio arrives as 'speech' events. → id
  speakStart: (text) => ipcRenderer.invoke('judith:speak-start', text),
  // A drawing or board command whose sentence just started.
  show: (command) => ipcRenderer.send('judith:show', command),
  // The overlay finished drawing a mark (the voice may talk about it now).
  marked: () => ipcRenderer.send('judith:marked'),
  timing: (step) => ipcRenderer.send('judith:timing', step),
  summon: () => ipcRenderer.send('judith:summon'),
  summonZone: () => ipcRenderer.send('judith:summon-zone'),
  close: () => ipcRenderer.send('judith:close'),
  // The pointer is over the notch (it takes the clicks) or not (they go through).
  interactive: (on) => ipcRenderer.send('judith:interactive', on),
  // The state the notch shows; the summon shortcut depends on it.
  notchState: (state) => ipcRenderer.send('judith:notch-state', state),
  log: (text) => ipcRenderer.send('judith:log', text),
  // Autonomous agent mode: the user's answer to "Vas-y / Non".
  confirmAnswer: (yes) => ipcRenderer.send('judith:confirm-answer', yes === true),
  // Where the notch really is inside its transparent window.
  notchBox: (box) => ipcRenderer.send('judith:notch-box', box),
  // The settings panel: which engine answers (Claude Code, Codex, Cursor, an API key).
  settings: {
    get: () => ipcRenderer.invoke('judith:settings-get'),
    test: (input) => ipcRenderer.invoke('judith:settings-test', input),
    save: (input) => ipcRenderer.invoke('judith:settings-save', input),
  },
  // The zone of the screen to explain: start drawing it, the drawn zone
  // (fractions of the display, or null), forget it.
  pickZone: () => ipcRenderer.send('judith:pick-zone'),
  zoneSelected: (zone) => ipcRenderer.send('judith:zone-selected', zone),
  dropZone: () => ipcRenderer.send('judith:drop-zone'),
  // A document, page or site Judith made or mentioned.
  openLink: (url) => ipcRenderer.send('judith:open-link', url),
  // board
  openPath: (path) => ipcRenderer.send('judith:open-path', path),
  preview: (path) => ipcRenderer.send('judith:preview', path),
  closeBoard: () => ipcRenderer.send('judith:close-board'),
  resizeBoard: (height) => ipcRenderer.send('judith:resize-board', height),
  // The 3D scene frame ran the model's code: { id, ok, error }.
  sceneResult: (result) => ipcRenderer.send('judith:scene-result', result),
  on(event, listener) {
    if (EVENTS.includes(event)) ipcRenderer.on(`judith:${event}`, (_e, data) => listener(data));
  },
});
