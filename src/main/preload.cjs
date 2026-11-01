// Bridge between Judith's windows and the main process (preloads stay CommonJS).
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = ['state', 'delta', 'answer', 'error', 'marks', 'clear', 'focus', 'tool', 'approval', 'approved'];

contextBridge.exposeInMainWorld('judith', {
  ask: (question) => ipcRenderer.invoke('judith:ask', question),
  close: () => ipcRenderer.send('judith:close'),
  approve: (id, allow) => ipcRenderer.send('judith:approve', { id, allow }),
  resize: (size) => ipcRenderer.send('judith:resize', size),
  on(event, listener) {
    if (EVENTS.includes(event)) ipcRenderer.on(`judith:${event}`, (_e, data) => listener(data));
  },
});
