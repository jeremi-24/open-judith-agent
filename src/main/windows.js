import { BrowserWindow } from 'electron';
import { join } from 'node:path';

const here = import.meta.dirname;
const renderer = (file) => join(here, '..', 'renderer', file);
// The notch window never changes size: it is a fixed, transparent stage at
// the top of the screen, as large as the biggest notch, and the notch animates
// inside it. Resizing the window on every animation frame (the old way) made
// the motion jerky, and a window moving under the mouse could swallow clicks.
// Outside the notch, the stage lets clicks through (see setNotchInteractive).
export const BUBBLE_WIDTH = 760;
export const BUBBLE_HEIGHT = 520;

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
    height: BUBBLE_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    // Fixed size: a transparent window that is also resizable can misbehave
    // on Windows. It is only ever moved (setPosition), never resized.
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: secure,
  });
  hideFromCaptures(win);
  setNotchInteractive(win, false);
  win.loadFile(renderer('bubble.html'));
  return win;
}

// The pointer is over the notch: the window takes the clicks. Elsewhere on the
// transparent stage, clicks go to the app underneath, and mouse moves are still
// forwarded so the page knows when the pointer comes back over the notch.
export function setNotchInteractive(win, on) {
  if (on) win.setIgnoreMouseEvents(false);
  else win.setIgnoreMouseEvents(true, { forward: true });
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

// The welcome window: what Judith does, then the few settings that matter.
// A normal window (in the taskbar, with Judith's icon), shown on first start.
export function createOnboarding(icon) {
  const win = new BrowserWindow({
    width: 900,
    height: 620,
    minWidth: 720,
    minHeight: 560,
    // Shown at once: its dark background avoids a white flash.
    show: true,
    center: true,
    frame: false,
    resizable: true,
    backgroundColor: '#14111d',
    title: 'Bienvenue · Judith',
    icon,
    webPreferences: secure,
  });
  win.loadFile(renderer('onboarding.html'));
  return win;
}
