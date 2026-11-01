import { app, globalShortcut, ipcMain, Menu, nativeImage, screen, shell, Tray } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configPath, loadConfig } from './config.js';
import { captureDisplay } from './capture.js';
import { BUBBLE_WIDTH, createBubble, createOverlay, setCaptureProtection } from './windows.js';
import { ClaudeCodeEngine } from '../engine/claude-code.js';
import { buildSystemPrompt, buildUserContent } from '../core/prompt.js';
import { extractAnnotations, toPixels, visibleText } from '../core/annotations.js';

if (!app.requestSingleInstanceLock()) app.quit();

const config = loadConfig();
const iconPath = join(import.meta.dirname, '..', '..', 'assets', 'icon.png');
let bubble, overlay, tray, engine, warmingUp;

// The screenshot taken when Judith is summoned, before her bubble appears.
let session = { display: null, image: null };

function send(win, event, data) {
  if (win && !win.isDestroyed()) win.webContents.send(`judith:${event}`, data);
}

const cursorDisplay = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Without capture protection, Judith steps out of the frame while she looks.
async function look(display) {
  if (config.hideFromScreenRecordings) return captureDisplay(display);
  bubble.setOpacity(0);
  overlay.hide();
  await wait(120);
  try {
    return await captureDisplay(display);
  } finally {
    bubble.setOpacity(1);
  }
}

async function summon() {
  const display = cursorDisplay();
  clearMarks();
  let image = null;
  try {
    image = await look(display);
  } catch (error) {
    send(bubble, 'error', `Je n'arrive pas à voir ton écran : ${error.message}`);
  }
  session = { display, image };

  placeBubble(display, bubble.getBounds());
  bubble.show();
  bubble.focus();
  send(bubble, 'focus');
}

// The notch is glued to the very top of the screen, centered unless it had
// to slide aside (dodgeX) to uncover a mark.
let dodgeX = null;
function placeBubble(display, { width, height }) {
  const { x, y, width: screenWidth } = display.bounds;
  bubble.setBounds({ x: dodgeX ?? Math.round(x + (screenWidth - width) / 2), y, width, height });
}

function hide() {
  bubble.hide();
  clearMarks();
}

function drawMarks(marks) {
  const { display } = session;
  if (!marks.length || !display) return;
  const { bounds } = display;
  const pixels = marks.map((m) => toPixels(m, bounds));
  dodgeMarks(display, pixels);
  overlay.setBounds(bounds);
  send(overlay, 'marks', { marks: pixels });
  overlay.showInactive();
}

// If the notch sits on top of what Judith points at, it slides aside.
function dodgeMarks(display, pixels) {
  const b = bubble.getBounds();
  const { x: left, width: screenWidth } = display.bounds;
  const hidden = pixels.some((m) => {
    const mx = left + m.cx;
    return mx + m.rx > b.x && mx - m.rx < b.x + b.width && display.bounds.y + m.cy - m.ry < b.y + b.height;
  });
  if (!hidden) return;
  const onLeft = pixels[0].cx < screenWidth / 2;
  dodgeX = onLeft ? left + screenWidth - b.width - 24 : left + 24;
  bubble.setBounds({ ...b, x: dodgeX });
}

function clearMarks() {
  send(overlay, 'clear');
  overlay?.hide();
  if (dodgeX !== null && session.display) {
    dodgeX = null;
    placeBubble(session.display, bubble.getBounds());
  }
}

async function ask(question) {
  await warmingUp;
  const display = session.display ?? cursorDisplay();
  // The first question uses the summon screenshot; follow-ups look again
  // (Judith's own windows are excluded from captures).
  const image = session.image ?? (await look(display).catch(() => null));
  session = { display, image: null };

  clearMarks();
  send(bubble, 'state', 'thinking');
  try {
    const result = await engine.ask(buildUserContent({ question, image }));
    const { text, steps, marks } = extractAnnotations(result.text);
    console.log(`[judith] answered in ${(result.durationMs / 1000).toFixed(1)} s, ${marks.length} mark(s)`);
    send(bubble, 'answer', { text, steps, durationMs: result.durationMs });
    drawMarks(marks);
  } catch (error) {
    send(bubble, 'error', error.message);
  }
}

function setMode(mode) {
  config.mode = mode;
  engine.setMode(mode);
  send(bubble, 'mode', mode);
  buildTrayMenu();
}

function newConversation() {
  engine.restart();
  hide();
}

function buildTrayMenu() {
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Demander à Judith (${config.shortcut})`, click: summon },
      { type: 'separator' },
      { label: 'Montrer seulement', type: 'radio', checked: config.mode === 'show', click: () => setMode('show') },
      { label: 'Montrer et agir', type: 'radio', checked: config.mode === 'act', click: () => setMode('act') },
      { type: 'separator' },
      { label: 'Nouvelle conversation', click: newConversation },
      { label: 'Ouvrir la configuration', click: () => shell.openPath(configPath()) },
      { type: 'separator' },
      { label: 'Quitter', role: 'quit' },
    ]),
  );
}

app.whenReady().then(() => {
  setCaptureProtection(config.hideFromScreenRecordings);
  bubble = createBubble();
  overlay = createOverlay();

  engine = new ClaudeCodeEngine({
    claudePath: config.claudePath,
    cwd: config.workingDirectory,
    model: config.model,
    mode: config.mode,
    systemPrompt: buildSystemPrompt({ language: config.language }),
  });
  engine.on('delta', (text) => send(bubble, 'delta', visibleText(text)));
  engine.on('log', (text) => console.error('[claude]', text.trim()));
  // Starts Claude Code and loads its context now, so the first real question is fast.
  warmingUp = engine.ask([{ type: 'text', text: 'Réponds seulement : prête.' }]).catch((error) => {
    console.error('[judith] warm-up failed:', error.message);
  });

  tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }));
  tray.setToolTip('Judith');
  tray.on('click', summon);
  buildTrayMenu();

  if (!globalShortcut.register(config.shortcut, summon)) {
    console.error(`[judith] shortcut ${config.shortcut} is already taken`);
  }

  ipcMain.handle('judith:ask', (_e, question) => ask(String(question)));
  ipcMain.on('judith:close', hide);
  ipcMain.on('judith:mode', (_e, mode) => setMode(mode));
  ipcMain.on('judith:resize', (_e, size) => {
    const width = Math.min(600, Math.max(BUBBLE_WIDTH, Math.ceil(size?.width ?? 0)));
    const height = Math.min(400, Math.max(48, Math.ceil(size?.height ?? 0)));
    placeBubble(session.display ?? cursorDisplay(), { width, height });
  });
  bubble.webContents.on('did-finish-load', () => send(bubble, 'mode', config.mode));
  bubble.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 'warning') console.error('[bubble]', event.message);
  });

  // Dev: JUDITH_DEMO="question" summons Judith and asks it at launch.
  // With JUDITH_DEMO_SHOT=file.png it also saves a screenshot and quits.
  if (process.env.JUDITH_DEMO) {
    warmingUp.then(async () => {
      await summon();
      await ask(process.env.JUDITH_DEMO);
      const shot = process.env.JUDITH_DEMO_SHOT;
      if (!shot) return;
      await wait(1500);
      console.log('[judith] bubble', JSON.stringify(bubble.getBounds()));
      const image = await captureDisplay(session.display ?? cursorDisplay());
      writeFileSync(shot, Buffer.from(image.data, 'base64'));
      app.quit();
    });
  }
});

app.on('second-instance', summon);
app.on('window-all-closed', () => {}); // lives in the tray
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  engine?.stop();
});
