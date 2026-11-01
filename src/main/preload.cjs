// Bridge between Judith's windows and the main process (preloads stay CommonJS).
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = [
  // notch
  'focus', 'idle', 'ask', 'cmd', 'answer', 'error', 'tool', 'approval', 'approved', 'stale', 'marked', 'speech', 'link',
  // overlay (and the notch, for 'zone')
  'mark', 'clear', 'scan', 'shift', 'select', 'zone',
  // board
  'board', 'note', 'visual', 'activity', 'clear-board',
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
  approve: (id, allow) => ipcRenderer.send('judith:approve', { id, allow }),
  resize: (size) => ipcRenderer.send('judith:resize', size),
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
  on(event, listener) {
    if (EVENTS.includes(event)) ipcRenderer.on(`judith:${event}`, (_e, data) => listener(data));
  },
});
