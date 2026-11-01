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
  // Judith talks after a global shortcut or a spoken question: there is never
  // a click in her page, so the usual "user gesture" rule would mute her.
  autoplayPolicy: 'no-user-gesture-required',
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

// The board, on the side of the screen: notes, visuals and activity.
export const BOARD_WIDTH = 340;
export function createBoard() {
  const win = new BrowserWindow({
    width: BOARD_WIDTH,
    height: 200,
    minWidth: 200,
    minHeight: 60,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: secure,
  });
  hideFromCaptures(win);
  win.loadFile(renderer('board.html'));
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
