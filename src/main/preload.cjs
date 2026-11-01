// Bridge between Judith's windows and the main process (preloads stay CommonJS).
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = [
  // notch
  'focus', 'idle', 'ask', 'cmd', 'answer', 'error', 'tool', 'approval', 'approved',
  // overlay
  'mark', 'clear', 'scan',
  // board
  'board', 'note', 'visual', 'activity', 'clear-board',
];

contextBridge.exposeInMainWorld('judith', {
  ask: (question) => ipcRenderer.invoke('judith:ask', question),
  // audio: Float32Array, mono 16 kHz → text.
  transcribe: (audio) => ipcRenderer.invoke('judith:transcribe', audio),
  // text → { samples: Float32Array, sampleRate } with the neural voice, or null.
  speak: (text) => ipcRenderer.invoke('judith:speak', text),
  // A drawing or board command whose sentence just started.
  show: (command) => ipcRenderer.send('judith:show', command),
  summon: () => ipcRenderer.send('judith:summon'),
  close: () => ipcRenderer.send('judith:close'),
  approve: (id, allow) => ipcRenderer.send('judith:approve', { id, allow }),
  resize: (size) => ipcRenderer.send('judith:resize', size),
  // board
  openPath: (path) => ipcRenderer.send('judith:open-path', path),
  preview: (path) => ipcRenderer.send('judith:preview', path),
  closeBoard: () => ipcRenderer.send('judith:close-board'),
  resizeBoard: (height) => ipcRenderer.send('judith:resize-board', height),
  on(event, listener) {
    if (EVENTS.includes(event)) ipcRenderer.on(`judith:${event}`, (_e, data) => listener(data));
  },
});
