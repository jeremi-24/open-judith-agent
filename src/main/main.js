import { app, globalShortcut, ipcMain, Menu, nativeImage, screen, session as sessions, shell, Tray } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { startBridge } from './bridge.js';
import { configPath, loadConfig } from './config.js';
import { ensureVoice } from './models.js';
import { captureDisplay } from './capture.js';
import { BUBBLE_WIDTH, createBubble, createOverlay, setCaptureProtection } from './windows.js';
import { ClaudeCodeEngine } from '../engine/claude-code.js';
import { buildSystemPrompt, buildUserContent, describeApproval, describeTool } from '../core/prompt.js';
import { extractAnnotations, toPixels, visibleText } from '../core/annotations.js';

if (!app.requestSingleInstanceLock()) app.quit();

const config = loadConfig();
const root = join(import.meta.dirname, '..', '..');
const iconPath = join(root, 'assets', 'icon.png');
let bubble, overlay, tray, engine, warmingUp;

// Tools Judith may use without asking: opening things and reading.
// Everything else (editing files, running commands) goes through the notch.
const ALLOWED_TOOLS = [
  'mcp__judith__open_app',
  'mcp__judith__find_apps',
  'mcp__judith__open_url',
  'mcp__judith__open_path',
  'Read',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
];

// The screenshot taken when Judith is summoned, before her notch appears.
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
  send(bubble, 'focus', { listen: config.voiceInput && speechReady });
}

// Whisper, in a worker thread. Pressing the shortcut again while Judith
// listens just sends what was said (handled by the notch).
let speech = null;
let speechReady = false;
let speechJob = 0;
const speechJobs = new Map();
function startSpeech() {
  if (!config.voiceInput) return;
  speech = new Worker(join(import.meta.dirname, 'stt-worker.js'), {
    workerData: { model: config.speechModel, language: config.language, cacheDir: join(app.getPath('userData'), 'models') },
  });
  speech.on('message', (message) => {
    if ('ready' in message) {
      speechReady = message.ready;
      console.log(message.ready ? '[judith] voice input ready' : `[judith] voice input off: ${message.error}`);
      return;
    }
    const job = speechJobs.get(message.id);
    speechJobs.delete(message.id);
    if (message.error) job?.reject(new Error(message.error));
    else job?.resolve(message.text);
  });
  speech.on('error', (error) => console.error('[judith] speech worker:', error.message));
}

// Judith's neural voice, in its own process (see tts-process.js).
let tts = null;
let ttsReady = false;
let ttsJob = 0;
const ttsJobs = new Map();
async function startVoice() {
  if (!config.voice || config.voice === 'windows') return;
  try {
    const voice = await ensureVoice(config.voice, join(app.getPath('userData'), 'models'));
    tts = fork(join(import.meta.dirname, 'tts-process.js'), [], {
      serialization: 'advanced', // typed arrays cross the pipe as they are
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        JUDITH_VOICE: JSON.stringify({ path: voice.path, model: voice.model, speed: config.voiceSpeed }),
      },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      windowsHide: true,
    });
    tts.on('message', (message) => {
      if (message.ready) {
        ttsReady = true;
        console.log(`[judith] voice ${config.voice} ready`);
        return;
      }
      const job = ttsJobs.get(message.id);
      ttsJobs.delete(message.id);
      if (message.error) job?.reject(new Error(message.error));
      // Copy: Electron's IPC refuses the externally backed array we receive.
      else job?.resolve({ samples: new Float32Array(message.samples), sampleRate: message.sampleRate });
    });
    tts.on('exit', (code) => {
      ttsReady = false;
      if (code) console.error(`[judith] voice process stopped (${code}), using Windows voices`);
    });
  } catch (error) {
    console.error(`[judith] voice ${config.voice} unavailable, using Windows voices: ${error.message}`);
  }
}

function speak(text) {
  if (!tts || !ttsReady) return Promise.resolve(null); // the notch falls back to Windows voices
  const id = ++ttsJob;
  if (process.env.JUDITH_DEMO) console.log('[judith] says', JSON.stringify(text.slice(0, 50)));
  return new Promise((resolve, reject) => {
    ttsJobs.set(id, { resolve, reject });
    tts.send({ id, text });
  });
}

function transcribe(audio) {
  if (!speech || !speechReady) return Promise.reject(new Error("La voix n'est pas encore prête, écris ta question."));
  const id = ++speechJob;
  return new Promise((resolve, reject) => {
    speechJobs.set(id, { resolve, reject });
    speech.postMessage({ id, audio });
  });
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
  // The first question uses the summon screenshot; follow-ups look again.
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

// Claude Code wants to edit a file or run a command: the notch asks the user.
const approvals = new Map();
let approvalId = 0;
function requestApproval(tool, input) {
  const id = ++approvalId;
  console.log(`[judith] asks permission for ${tool}`);
  if (!bubble.isVisible()) {
    placeBubble(session.display ?? cursorDisplay(), bubble.getBounds());
    bubble.showInactive();
  }
  send(bubble, 'approval', { id, ...describeApproval(tool, input, config.language) });
  return new Promise((resolve) => {
    const timer = setTimeout(() => settleApproval(id, false), 120_000);
    approvals.set(id, { resolve, timer });
    const demo = process.env.JUDITH_DEMO_APPROVE;
    if (demo) setTimeout(() => settleApproval(id, demo === 'yes'), 2500);
  });
}

function settleApproval(id, allow) {
  const pending = approvals.get(id);
  if (!pending) return;
  approvals.delete(id);
  clearTimeout(pending.timer);
  pending.resolve(allow);
  send(bubble, 'approved', { id, allow });
}

function newConversation() {
  engine.restart();
  hide();
}

function buildTrayMenu() {
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Demander à Judith (${config.shortcut})`, click: summon },
      { label: 'Nouvelle conversation', click: newConversation },
      { label: 'Ouvrir la configuration', click: () => shell.openPath(configPath()) },
      { type: 'separator' },
      { label: 'Quitter', role: 'quit' },
    ]),
  );
}

app.whenReady().then(async () => {
  // Judith's own pages may use the microphone; nothing else is granted.
  const allowMedia = (permission) => permission === 'media';
  sessions.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowMedia(permission)));
  sessions.defaultSession.setPermissionCheckHandler((_wc, permission) => allowMedia(permission));
  startSpeech();
  startVoice();

  setCaptureProtection(config.hideFromScreenRecordings);
  bubble = createBubble();
  overlay = createOverlay();

  // Judith's tools run in an MCP server that Claude Code starts. Electron
  // itself runs it as plain Node, so no separate Node install is needed.
  const bridge = await startBridge({ onApprove: requestApproval });
  const mcpConfig = join(app.getPath('userData'), 'mcp.json');
  writeFileSync(
    mcpConfig,
    JSON.stringify({
      mcpServers: {
        judith: {
          command: process.execPath,
          args: [join(root, 'src', 'mcp', 'server.js')],
          env: { ELECTRON_RUN_AS_NODE: '1', JUDITH_BRIDGE: bridge.url, JUDITH_TOKEN: bridge.token },
        },
      },
    }),
  );

  engine = new ClaudeCodeEngine({
    claudePath: config.claudePath,
    cwd: config.workingDirectory,
    model: config.model,
    systemPrompt: buildSystemPrompt({ language: config.language }),
    extraArgs: [
      '--mcp-config', mcpConfig,
      '--allowedTools', ALLOWED_TOOLS.join(','),
      '--permission-prompt-tool', 'mcp__judith__approve',
    ],
  });
  // The warm-up answer stays silent: it never reaches the notch.
  let warm = false;
  engine.on('delta', (text) => warm && send(bubble, 'delta', visibleText(text)));
  engine.on('tool', ({ name, input }) => {
    console.log(`[judith] tool ${name} ${JSON.stringify(input).slice(0, 120)}`);
    send(bubble, 'tool', describeTool(name, input, config.language));
  });
  engine.on('log', (text) => console.error('[claude]', text.trim()));
  // Starts Claude Code and loads its context now, so the first real question is fast.
  warmingUp = engine
    .ask([{ type: 'text', text: 'Réponds seulement : prête.' }])
    .catch((error) => console.error('[judith] warm-up failed:', error.message))
    .finally(() => {
      warm = true;
    });

  tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }));
  tray.setToolTip('Judith');
  tray.on('click', summon);
  buildTrayMenu();

  if (!globalShortcut.register(config.shortcut, summon)) {
    console.error(`[judith] shortcut ${config.shortcut} is already taken`);
  }

  ipcMain.handle('judith:ask', (_e, question) => ask(String(question)));
  ipcMain.handle('judith:transcribe', (_e, audio) => transcribe(audio));
  ipcMain.handle('judith:speak', (_e, text) => speak(String(text)));
  ipcMain.on('judith:close', hide);
  ipcMain.on('judith:approve', (_e, { id, allow }) => settleApproval(id, allow === true));
  ipcMain.on('judith:resize', (_e, size) => {
    const width = Math.min(600, Math.max(BUBBLE_WIDTH, Math.ceil(size?.width ?? 0)));
    const height = Math.min(400, Math.max(48, Math.ceil(size?.height ?? 0)));
    placeBubble(session.display ?? cursorDisplay(), { width, height });
  });
  bubble.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 'warning') console.error('[bubble]', event.message);
  });

  // Dev: JUDITH_DEMO="question" summons Judith and asks it at launch.
  // With JUDITH_DEMO_SHOT=file.jpg it also saves a screenshot and quits.
  // JUDITH_DEMO_APPROVE=yes|no answers permission requests automatically.
  // JUDITH_DEMO_AUDIO=question.wav (16 kHz) goes through Whisper first.
  if (process.env.JUDITH_DEMO) {
    warmingUp.then(async () => {
      let question = process.env.JUDITH_DEMO;
      const wav = process.env.JUDITH_DEMO_AUDIO;
      if (wav) {
        while (!speechReady) await wait(500);
        const { decodeWav } = await import('../core/audio.js');
        const started = Date.now();
        question = await transcribe(decodeWav(readFileSync(wav)).samples);
        console.log(`[judith] heard "${question}" in ${((Date.now() - started) / 1000).toFixed(1)} s`);
      }
      await summon();
      await ask(question);
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
  speech?.terminate();
  tts?.kill();
});
