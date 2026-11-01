import { BrowserWindow } from 'electron';
import { join } from 'node:path';

const here = import.meta.dirname;
const renderer = (file) => join(here, '..', 'renderer', file);
// The compact notch (360 px) plus its two shoulders; it grows from there.
export const BUBBLE_WIDTH = 388;

const secure = {
  preload: join(here, 'preload.cjs'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
};

// With protection on, Judith's windows are invisible to every capture: hers,
// but also screen recorders (OBS, Snipping Tool). Turn it off to film demos.
let protect = true;
export function setCaptureProtection(on) {
  protect = on;
}

function hideFromCaptures(win) {
  win.setContentProtection(protect);
  win.setAlwaysOnTop(true, 'screen-saver');
}

export function createBubble() {
  const win = new BrowserWindow({
    width: BUBBLE_WIDTH,
    height: 120,
    minWidth: 100,
    minHeight: 40,
    show: false,
    frame: false,
    transparent: true,
    // Must stay resizable, or Windows ignores setBounds; there is no frame to drag.
    resizable: true,
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
