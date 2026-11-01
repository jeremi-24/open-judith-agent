import { app, globalShortcut, ipcMain, Menu, nativeImage, screen, session as sessions, shell, Tray } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fork } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { startBridge } from './bridge.js';
import { configPath, loadConfig } from './config.js';
import { ensureVoice } from './models.js';
import { captureDisplay } from './capture.js';
import { BOARD_WIDTH, createBoard, createBubble, createOverlay, setCaptureProtection } from './windows.js';
import { ClaudeCodeEngine } from '../engine/claude-code.js';
import { buildSystemPrompt, buildUserContent, describeApproval, describeTool } from '../core/prompt.js';
import { toPixels } from '../core/annotations.js';
import { createScriptReader } from '../core/script.js';

if (!app.requestSingleInstanceLock()) app.quit();

const config = loadConfig();
const root = join(import.meta.dirname, '..', '..');
const iconPath = join(root, 'assets', 'icon.png');
let bubble, overlay, board, tray, engine, warmingUp;

// Tools Judith may use without asking: opening things, reading, showing.
// Everything else (editing files, running commands) goes through the notch.
const ALLOWED_TOOLS = [
  'mcp__judith__open_app',
  'mcp__judith__find_apps',
  'mcp__judith__open_url',
  'mcp__judith__open_path',
  'mcp__judith__show_visual',
  'Read',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
];

// The screenshot taken when Judith is summoned, before her notch wakes up.
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
  board.setOpacity(0);
  await wait(120);
  try {
    return await captureDisplay(display);
  } finally {
    bubble.setOpacity(1);
    board.setOpacity(1);
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

// ----- voice in: Whisper, in a worker thread -----
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

function transcribe(audio) {
  if (!speech || !speechReady) return Promise.reject(new Error("La voix n'est pas encore prête, écris ta question."));
  const id = ++speechJob;
  return new Promise((resolve, reject) => {
    speechJobs.set(id, { resolve, reject });
    speech.postMessage({ id, audio });
  });
}

// ----- voice out: Judith's neural voice, in its own process (tts-process.js) -----
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

// ----- the notch -----
// Glued to the very top of the screen, always centered.
function placeBubble(display, { width, height }) {
  const { x, y, width: screenWidth } = display.bounds;
  bubble.setBounds({ x: Math.round(x + (screenWidth - width) / 2), y, width, height });
}

// Back to the small idle notch.
function hide() {
  send(bubble, 'idle');
  send(overlay, 'scan', false);
  clearMarks();
}

// ----- marks on the screen -----
function drawMark(mark) {
  const display = session.display ?? cursorDisplay();
  const { bounds } = display;
  if (!overlay.isVisible()) {
    overlay.setBounds(bounds);
    overlay.showInactive();
  }
  send(overlay, 'mark', toPixels(mark, bounds));
}

function clearMarks() {
  send(overlay, 'clear');
  overlay?.hide();
}

// ----- the board: notes, visuals and what Claude Code did -----
// Bottom-left corner, growing upwards: tabs and toolbars stay visible.
function placeBoard(height) {
  const { workArea } = session.display ?? cursorDisplay();
  const h = Math.min(workArea.height - 120, Math.max(80, Math.ceil(height)));
  board.setBounds({ x: workArea.x + 8, y: workArea.y + workArea.height - h - 8, width: BOARD_WIDTH, height: h });
}

function showBoard() {
  if (board.isVisible()) return;
  placeBoard(board.getBounds().height);
  board.showInactive();
}

const PREVIEWABLE = new Set(['.html', '.htm', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.md', '.txt', '.csv', '.json']);
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

// A file Claude Code created, shown in the board's visual frame.
function preview(path) {
  if (!existsSync(path)) return;
  const ext = extname(path).toLowerCase();
  const name = path.split(/[\\/]/).pop();
  let html;
  if (IMAGE_TYPES[ext]) {
    html = `<img alt="" style="max-width:100%" src="data:${IMAGE_TYPES[ext]};base64,${readFileSync(path).toString('base64')}">`;
  } else if (ext === '.html' || ext === '.htm' || ext === '.svg') {
    html = readFileSync(path, 'utf8');
  } else {
    const escaped = readFileSync(path, 'utf8')
      .slice(0, 20000)
      .replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    html = `<pre style="font:12px/1.5 Consolas,monospace;white-space:pre-wrap;margin:0">${escaped}</pre>`;
  }
  showBoard();
  send(board, 'visual', { title: name, html });
}

// What Judith's script asks to show, when its sentence starts.
function show(command) {
  if (command.type === 'mark') return drawMark(command);
  if (command.type === 'clear') return clearMarks();
  if (command.type === 'board') {
    showBoard();
    return send(board, 'board', { title: command.title, subtitle: command.subtitle });
  }
  if (command.type === 'note') {
    showBoard();
    send(board, 'note', { text: command.text });
  }
}

// Every action Claude Code takes appears on the board.
const QUIET_TOOLS = new Set(['Read', 'Glob', 'Grep', 'TodoWrite', 'mcp__judith__find_apps', 'mcp__judith__approve']);
const actions = new Map();
function trackTool({ id, name, input }) {
  if (QUIET_TOOLS.has(name)) return;
  const file = input.file_path ?? input.notebook_path ?? null;
  const item = {
    id,
    label: describeTool(name, input, config.language),
    detail: input.command ?? file ?? input.url ?? input.path ?? '',
    file,
    previewable: Boolean(file && PREVIEWABLE.has(extname(file).toLowerCase())),
    status: 'running',
  };
  actions.set(id, item);
  showBoard();
  send(board, 'activity', item);
}

function trackResult({ id, output, isError }) {
  const item = actions.get(id);
  if (!item) return;
  Object.assign(item, { status: isError ? 'error' : 'ok', output: output.trim().slice(0, 4000) });
  send(board, 'activity', item);
}

// ----- asking -----
let currentReader = null;
let lastAsk = null;
async function ask(question) {
  await warmingUp;
  const display = session.display ?? cursorDisplay();
  // The first question uses the summon screenshot; follow-ups look again.
  const image = session.image ?? (await look(display).catch(() => null));
  session = { display, image: null };

  clearMarks();
  overlay.setBounds(display.bounds);
  overlay.showInactive();
  send(overlay, 'scan', true);

  // Script lines go to the notch as soon as they are complete.
  let commands = 0;
  const reader = createScriptReader((command) => {
    commands += 1;
    send(bubble, 'cmd', command);
  });
  currentReader = reader;
  try {
    const result = await engine.ask(buildUserContent({ question, image }));
    reader.finish(result.streamed || result.text);
    console.log(`[judith] answered in ${(result.durationMs / 1000).toFixed(1)} s, ${commands} command(s)`);
  } catch (error) {
    send(bubble, 'error', error.message);
  } finally {
    currentReader = null;
    send(overlay, 'scan', false);
    send(bubble, 'answer');
  }
}

// ----- approvals: Claude Code wants to edit a file or run a command -----
const approvals = new Map();
let approvalId = 0;
function requestApproval(tool, input) {
  const id = ++approvalId;
  console.log(`[judith] asks permission for ${tool}`);
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
  board = createBoard();

  // Judith's tools run in an MCP server that Claude Code starts. Electron
  // itself runs it as plain Node, so no separate Node install is needed.
  const bridge = await startBridge({
    onApprove: requestApproval,
    onVisual: (title, html) => {
      showBoard();
      send(board, 'visual', { title, html });
    },
  });
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
  // The warm-up answer stays silent: no reader is listening yet.
  engine.on('delta', (text) => currentReader?.push(text));
  engine.on('tool', (tool) => {
    console.log(`[judith] tool ${tool.name} ${JSON.stringify(tool.input).slice(0, 120)}`);
    send(bubble, 'tool', describeTool(tool.name, tool.input, config.language));
    trackTool(tool);
  });
  engine.on('tool-result', trackResult);
  engine.on('log', (text) => console.error('[claude]', text.trim()));
  // Starts Claude Code and loads its context now, so the first real question is fast.
  warmingUp = engine
    .ask([{ type: 'text', text: 'Réponds seulement : say prête.' }])
    .catch((error) => console.error('[judith] warm-up failed:', error.message));

  // The idle notch ("Judith ●") is always at the top of the screen.
  bubble.webContents.once('did-finish-load', () => {
    placeBubble(cursorDisplay(), bubble.getBounds());
    bubble.showInactive();
  });

  tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }));
  tray.setToolTip('Judith');
  tray.on('click', summon);
  buildTrayMenu();

  if (!globalShortcut.register(config.shortcut, summon)) {
    console.error(`[judith] shortcut ${config.shortcut} is already taken`);
  }

  ipcMain.handle('judith:ask', (_e, question) => (lastAsk = ask(String(question))));
  ipcMain.handle('judith:transcribe', (_e, audio) => transcribe(audio));
  ipcMain.handle('judith:speak', (_e, text) => speak(String(text)));
  ipcMain.on('judith:close', hide);
  ipcMain.on('judith:summon', summon);
  ipcMain.on('judith:show', (_e, command) => show(command));
  ipcMain.on('judith:approve', (_e, { id, allow }) => settleApproval(id, allow === true));
  ipcMain.on('judith:resize', (_e, size) => {
    const width = Math.min(720, Math.max(120, Math.ceil(size?.width ?? 0)));
    const height = Math.min(480, Math.max(40, Math.ceil(size?.height ?? 0)));
    placeBubble(session.display ?? cursorDisplay(), { width, height });
  });
  ipcMain.on('judith:open-path', (_e, path) => existsSync(path) && shell.openPath(path));
  ipcMain.on('judith:preview', (_e, path) => preview(String(path)));
  ipcMain.on('judith:close-board', () => {
    board.hide();
    send(board, 'clear-board');
    actions.clear();
  });
  ipcMain.on('judith:resize-board', (_e, height) => placeBoard(height));
  for (const win of [bubble, overlay, board]) {
    win.webContents.on('console-message', (event) => {
      if (event.level === 'error' || event.level === 'warning') console.error('[page]', event.message);
    });
  }

  // Dev: JUDITH_DEMO="question" summons Judith and asks it at launch.
  // With JUDITH_DEMO_SHOT=file.jpg it also saves a screenshot and quits,
  // JUDITH_DEMO_WAIT ms after the answer (default 1500).
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
      // Asked through the notch, exactly like a typed question.
      send(bubble, 'ask', question);
      while (!lastAsk) await wait(100);
      await lastAsk;
      const shot = process.env.JUDITH_DEMO_SHOT;
      if (!shot) return;
      await wait(Number(process.env.JUDITH_DEMO_WAIT ?? 1500));
      console.log('[judith] bubble', JSON.stringify(bubble.getBounds()), 'board', board.isVisible());
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
