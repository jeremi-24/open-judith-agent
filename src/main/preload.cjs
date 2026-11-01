// Bridge between Judith's windows and the main process (preloads stay CommonJS).
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = ['state', 'delta', 'answer', 'error', 'marks', 'clear', 'focus', 'mode'];

contextBridge.exposeInMainWorld('judith', {
  ask: (question) => ipcRenderer.invoke('judith:ask', question),
  close: () => ipcRenderer.send('judith:close'),
  setMode: (mode) => ipcRenderer.send('judith:mode', mode),
  resize: (height) => ipcRenderer.send('judith:resize', height),
  on(event, listener) {
    if (EVENTS.includes(event)) ipcRenderer.on(`judith:${event}`, (_e, data) => listener(data));
  },
});
