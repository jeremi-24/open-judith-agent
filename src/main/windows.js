import { BrowserWindow } from 'electron';
import { join } from 'node:path';

const here = import.meta.dirname;
const renderer = (file) => join(here, '..', 'renderer', file);
export const BUBBLE_WIDTH = 440;

const secure = {
  preload: join(here, 'preload.cjs'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
};

// Judith's own windows never appear in her screenshots.
function hideFromCaptures(win) {
  win.setContentProtection(true);
  win.setAlwaysOnTop(true, 'screen-saver');
}

export function createBubble() {
  const win = new BrowserWindow({
    width: BUBBLE_WIDTH,
    height: 200,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: secure,
  });
  hideFromCaptures(win);
  win.loadFile(renderer('bubble.html'));
  return win;
}

// Full-display, transparent and click-through: it only draws.
export function createOverlay() {
  const win = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: secure,
  });
  win.setIgnoreMouseEvents(true);
  hideFromCaptures(win);
  win.loadFile(renderer('overlay.html'));
  return win;
}
