import { app, clipboard, ClipboardItem, globalShortcut, ipcMain, Menu, nativeImage, Notification, screen, session as sessions, shell, Tray } from 'electron';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fork } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { startBridge } from './bridge.js';
import { configPath, loadConfig } from './config.js';
import { ensureVoice } from './models.js';
import { captureDisplay, captureFull, captureSmall } from './capture.js';
import { BOARD_WIDTH, createBoard, createBubble, createOverlay, setCaptureProtection } from './windows.js';
import { ClaudeCodeEngine } from '../engine/claude-code.js';
import { buildSystemPrompt, buildUserContent, describeApproval, describeTool } from '../core/prompt.js';
import { toPixels } from '../core/annotations.js';
import { averageLuma, bestShift, CHANGED, markCore, markRect, regionDiff, STALE } from '../core/pixels.js';
import { inkFor } from '../core/ink.js';
import { createScriptReader } from '../core/script.js';
import { isEcho, isGhost } from '../core/hallucinations.js';
import { decodeWav } from '../core/audio.js';
import { stripEmotions } from '../core/emotions.js';
import { needsScreen } from '../core/needs-screen.js';
import { findLinks, isCreation, speakable } from '../core/links.js';
import { fromZone, toZone } from '../core/zone.js';
import { addReminder, describeWhen, dueReminders } from '../core/reminders.js';

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
  'mcp__judith__look_at_screen',
  'mcp__judith__copy_screenshot',
  'mcp__judith__set_reminder',
  'mcp__judith__list_reminders',
  'mcp__judith__cancel_reminder',
  'Read',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
];

// The display Judith works on, and a tiny copy of the screen as she last saw
// it (to notice when it changes under her marks).
let session = { display: null, reference: null };

function send(win, event, data) {
  if (win && !win.isDestroyed()) win.webContents.send(`judith:${event}`, data);
}

const cursorDisplay = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Without capture protection, Judith steps out of the frame for capture().
async function withoutJudith(capture) {
  if (config.hideFromScreenRecordings) return capture();
  bubble.setOpacity(0);
  overlay.hide();
  board.setOpacity(0);
  await wait(120);
  try {
    return await capture();
  } finally {
    bubble.setOpacity(1);
    board.setOpacity(1);
    if (session.zone || shownMarks.length) overlay.showInactive();
  }
}

// With a zone drawn by the user, only that zone is sent: Claude's coordinates
// are then fractions of the zone (session.frame) until the next look.
// The tiny reference copy is taken the same way as the later checks, so
// only real changes count.
async function look(display) {
  const zone = session.zone;
  session.frame = zone;
  return withoutJudith(async () => ({ ...(await captureDisplay(display, zone)), small: await captureSmall(display) }));
}

// The copy_screenshot tool: the screen (or the zone the user drew) goes to
// the clipboard, ready to paste in WhatsApp, Discord, a mail…, and is saved
// as a PNG in Pictures\Judith. Judith never sends it herself.
async function copyScreenshot() {
  const display = session.display ?? cursorDisplay();
  try {
    const image = await withoutJudith(() => captureFull(display, session.zone));
    const png = image.toPNG();
    // Electron 44's clipboard follows the web API: items of Blobs, async.
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
    const folder = join(app.getPath('pictures'), 'Judith');
    mkdirSync(folder, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
    const path = join(folder, `judith-${stamp}.png`);
    writeFileSync(path, png);
    const { width, height } = image.getSize();
    console.log(`[judith] screenshot copied (${width}x${height}) and saved to ${path}`);
    return { path, width, height, zone: Boolean(session.zone) };
  } catch (error) {
    console.error('[judith] copy screenshot failed:', error.message);
    return { error: error.message };
  }
}

// ----- reminders: Judith says them out loud at their time -----
// Saved in reminders.json, so a restart loses nothing; one missed while
// Judith was off is given as soon as she starts again.
const REMINDER_CHECK_MS = 15_000;
let reminders = [];
const remindersPath = () => join(app.getPath('userData'), 'reminders.json');
function saveReminders() {
  try {
    writeFileSync(remindersPath(), JSON.stringify(reminders, null, 2));
  } catch (error) {
    console.error('[judith] reminders not saved:', error.message);
  }
}
function startReminders() {
  try {
    reminders = JSON.parse(readFileSync(remindersPath(), 'utf8'));
  } catch {
    reminders = [];
  }
  const check = () => {
    const { due, rest } = dueReminders(reminders);
    if (!due.length) return;
    reminders = rest;
    saveReminders();
    for (const reminder of due) {
      console.log(`[judith] reminder: ${reminder.text}`);
      new Notification({ title: 'Judith · Rappel', body: reminder.text, icon: iconPath }).show();
      send(bubble, 'reminder', { text: reminder.text });
    }
  };
  check();
  setInterval(check, REMINDER_CHECK_MS);
}
// The reminder tools (set, list, cancel), through the bridge.
function reminderTool({ action, when, text, id }) {
  if (action === 'set') {
    const result = addReminder(reminders, { when, text });
    if (result.error) return { error: result.error };
    reminders = result.list;
    saveReminders();
    return { ...result.reminder, said: describeWhen(result.reminder.at) };
  }
  if (action === 'cancel') {
    const before = reminders.length;
    reminders = reminders.filter((r) => id !== 'all' && r.id !== id);
    saveReminders();
    return { cancelled: before - reminders.length };
  }
  return { reminders: reminders.map((r) => ({ ...r, said: describeWhen(r.at) })) };
}

// Summoning is instant: Judith looks at the screen only if the question needs
// it (look_at_screen tool), not every time.
async function summon() {
  const display = cursorDisplay();
  clearMarks();
  // Where the mouse points when Judith is called: "c'est quoi ça ?" is about it.
  const cursor = screen.getCursorScreenPoint();
  const { x, y, width, height } = display.bounds;
  const pointer = { x: (cursor.x - x) / width, y: (cursor.y - y) / height };
  session = { display, reference: null, pointer, zone: null, frame: null };
  send(overlay, 'zone', null);

  bubbleAtRest = false; // the open notch is glued to the top edge
  placeBubble(display, bubble.getBounds());
  bubble.show();
  bubble.focus();
  const ears = liveEars();
  // No conversation in demo mode: nobody is there to answer.
  const conversation = config.conversation && !process.env.JUDITH_DEMO;
  send(bubble, 'focus', { conversation, interruptions: config.interruptions, stt: ears });
}

// ----- the zone: the user draws the part of the screen to explain -----
// The overlay catches the mouse while the user drags a rectangle (Escape or
// a simple click cancels); then it only shows the zone's frame. Judith keeps
// listening meanwhile: "c'est quoi ça ?" can be said while drawing.
let zonePicking = null;
let settleZone = null;
function pickZone() {
  if (zonePicking) return zonePicking;
  const display = session.display ?? cursorDisplay();
  session.display = display;
  overlay.setBounds(display.bounds);
  overlay.setIgnoreMouseEvents(false);
  overlay.setFocusable(true);
  overlay.show();
  overlay.focus();
  bubble.moveTop(); // the notch (and its X) stays above the veil
  send(overlay, 'select', true);
  zonePicking = new Promise((resolve) => {
    settleZone = (zone) => {
      settleZone = null;
      zonePicking = null;
      overlay.setIgnoreMouseEvents(true);
      overlay.setFocusable(false);
      send(overlay, 'select', false);
      session.zone = zone;
      send(overlay, 'zone', zone);
      send(bubble, 'zone', Boolean(zone));
      if (!zone && !shownMarks.length) overlay.hide();
      if (zone) console.log(`[judith] zone ${JSON.stringify(Object.values(zone).map((v) => +v.toFixed(3)))}`);
      bubble.focus();
      resolve(zone);
    };
  });
  return zonePicking;
}

// The conversation is over (or cancelled): the zone goes, the marks stay.
function dropZone() {
  if (settleZone) return settleZone(null);
  if (!session.zone) return;
  session.zone = null;
  send(overlay, 'zone', null);
  send(bubble, 'zone', false);
  if (!shownMarks.length) overlay.hide();
}

function summonWithZone() {
  summon();
  pickZone();
}

// ----- what Claude creates: documents, artifacts, designs, pages -----
// Claude Code would show them in its own app; Judith has no such pane, so
// she shows a card in the notch and opens creations in the browser.
let turnLinks = new Map();
let openedCreation = false;
// titled: the title comes from the answer ("[Mon doc](…)"), better than the
// default one found in a tool result.
function addLink(link, { titled = true } = {}) {
  if (!/^https?:\/\//i.test(link.url)) return;
  const known = turnLinks.get(link.url);
  if (known && (!titled || known.title === link.title)) return;
  turnLinks.set(link.url, link);
  send(bubble, 'link', { turn: activeTurn, ...link });
}
function openCreation(url) {
  if (openedCreation || !config.openCreations) return;
  openedCreation = true;
  console.log(`[judith] opening ${url}`);
  shell.openExternal(url);
}
// Creations named in a tool call or its result (Artifact publish/open, Docs…).
function creationsIn(text) {
  for (const link of findLinks(text, config.language)) {
    if (link.creation) addLink(link, { titled: false });
  }
}

// ----- voice in, cloud: Deepgram live listening (the user's own key) -----
// Words Judith should hear right, whatever the accent.
const KEYTERMS = ['Judith', 'Claude Code', 'GitHub', 'VS Code', 'VLC', 'CapCut', 'Blender', 'pull request', "capture d'écran", 'WhatsApp', 'Discord'];
function liveEars() {
  const key = config.deepgramKey || process.env.DEEPGRAM_API_KEY;
  if (config.speechInput !== 'deepgram' || !key) return null;
  return { provider: 'deepgram', key, model: config.deepgramModel, language: config.language, keyterms: KEYTERMS };
}

// ----- voice in, local: Whisper, in a worker thread -----
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
    // Phantom words Whisper invents in silence are not a question.
    else job?.resolve(isGhost(message.text) ? '' : message.text);
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
  // Siwis also backs up the cloud voice when it fails.
  if (!config.voice || config.voice === 'windows') return;
  try {
    // A cloud voice keeps Siwis ready as its backup.
    const local = config.voice === 'elevenlabs' || config.voice === 'fish' ? 'siwis' : config.voice;
    const voice = await ensureVoice(local, join(app.getPath('userData'), 'models'));
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
        console.log(`[judith] voice ${local} ready`);
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

// ----- voice out, cloud: ElevenLabs (the user's own key) -----
async function speakElevenLabs(text) {
  const key = config.elevenlabsKey || process.env.ELEVENLABS_API_KEY;
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${config.elevenlabsVoice}/stream?output_format=pcm_16000`,
    {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ text, model_id: config.elevenlabsModel, language_code: config.language }),
    },
  );
  if (!response.ok) throw new Error(`ElevenLabs ${response.status}: ${(await response.text()).slice(0, 200)}`);
  // Raw 16-bit PCM, 16 kHz, mono.
  const pcm = Buffer.from(await response.arrayBuffer());
  const samples = new Float32Array(pcm.length >> 1);
  for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768;
  return { samples, sampleRate: 16000 };
}

// ----- voice out, cloud: Fish Audio (the user's own key) -----
// The "s2.1-pro-free" model is free (until 30/11/2026 at least).
// Streamed: raw 16-bit PCM at 44.1 kHz arrives in pieces; the first one comes
// after ~1.1 s instead of ~4 s for the whole sentence. onChunk(audio) is
// called with ~0.25 s pieces as they arrive.
const FISH_RATE = 44100;
async function speakFish(text, onChunk) {
  const key = config.fishKey || process.env.FISH_API_KEY;
  const response = await fetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json', model: config.fishModel },
    body: JSON.stringify({ text, format: 'pcm', latency: 'balanced', ...(config.fishVoice ? { reference_id: config.fishVoice } : {}) }),
  });
  if (!response.ok) throw new Error(`Fish Audio ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const reader = response.body.getReader();
  let pending = Buffer.alloc(0);
  const flush = (all) => {
    const usable = all ? pending.length - (pending.length % 2) : Math.floor(pending.length / 2) * 2;
    if (!usable) return;
    const samples = new Float32Array(usable / 2);
    for (let i = 0; i < samples.length; i++) samples[i] = pending.readInt16LE(i * 2) / 32768;
    pending = pending.subarray(usable);
    onChunk({ samples, sampleRate: FISH_RATE });
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending = Buffer.concat([pending, Buffer.from(value)]);
    if (pending.length >= FISH_RATE / 2) flush(false); // ~0.25 s of audio
  }
  flush(true);
}

// speak(text, onChunk): every voice delivers its audio in one or more chunks.
const CLOUD_VOICES = {
  elevenlabs: { speak: async (text, onChunk) => onChunk(await speakElevenLabs(text)), key: () => config.elevenlabsKey || process.env.ELEVENLABS_API_KEY },
  fish: { speak: speakFish, key: () => config.fishKey || process.env.FISH_API_KEY },
};

let cloudVoiceFailed = false;
// A sentence is streamed to the notch as 'speech' events: { id, samples,
// sampleRate } chunks, then { id, done }. The notch starts playing the first
// chunk while the rest is still coming.
let speechId = 0;
function streamVoice(text) {
  const id = ++speechId;
  const push = (data) => send(bubble, 'speech', { id, ...data });
  (async () => {
    const cloud = CLOUD_VOICES[config.voice];
    if (cloud && !cloudVoiceFailed && cloud.key()) {
      let sent = 0;
      try {
        // Fish acts the [emotion] tags; the other voices would read them aloud.
        await cloud.speak(config.voice === 'fish' ? text : stripEmotions(text), (chunk) => {
          sent += 1;
          push(chunk);
        });
        if (process.env.JUDITH_DEMO) console.log('[judith] says (cloud)', JSON.stringify(text.slice(0, 90)));
        if (sent) return push({ done: true });
        // No audio at all: Judith's local voice, not a stranger's.
        console.error('[judith] cloud voice sent no audio, local voice instead');
      } catch (error) {
        // A bad key or no credit: say it once, then use the local voice.
        cloudVoiceFailed = true;
        console.error(`[judith] cloud voice off, local voice instead: ${error.message}`);
        if (sent) return push({ done: true });
      }
    }
    const audio = await speakLocal(stripEmotions(text)).catch(() => null);
    if (audio) push(audio);
    push({ done: true });
  })();
  return id;
}

function speakLocal(text) {
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
// At rest, a pill a few pixels below the top edge: what is right under
// the edge (tabs, title bars) stays clickable.
const REST_GAP = 6;
let bubbleAtRest = true;
function placeBubble(display, { width, height }) {
  const { x, y, width: screenWidth } = display.bounds;
  bubble.setBounds({ x: Math.round(x + (screenWidth - width) / 2), y: y + (bubbleAtRest ? REST_GAP : 0), width, height });
}

// Back to the small idle notch.
function hide() {
  send(bubble, 'idle');
  scanning = false;
  send(overlay, 'scan', false);
  dropZone();
  clearMarks();
}

// ----- marks on the screen, and their life cycle -----
// A mark is only true for the screen Judith looked at. It is not drawn if
// that part of the screen already changed (scroll, click, other window), and
// it disappears as soon as what is under it changes, or after a minute.
const MARK_LIFETIME_MS = 60_000;
const WATCH_EVERY_MS = 800;
let shownMarks = [];
let watcher = null;
let lastSmall = null; // { at, shot }: one tiny capture serves several marks
let scanning = false;

async function screenNow(display) {
  if (lastSmall && Date.now() - lastSmall.at < 400) return lastSmall.shot;
  const shot = await captureSmall(display);
  lastSmall = { at: Date.now(), shot };
  return shot;
}

// Judith's own windows move and change: never compare what is under them.
function ownAreas(display) {
  const { x, y, width, height } = display.bounds;
  return [bubble, board]
    .filter((w) => w.isVisible())
    .map((w) => w.getBounds())
    .map((b) => ({ x1: (b.x - x) / width, y1: (b.y - y) / height, x2: (b.x + b.width - x) / width, y2: (b.y + b.height - y) / height }));
}

async function drawMark(mark) {
  const display = session.display ?? cursorDisplay();
  const { bounds } = display;
  if (scanning) {
    // The scan animation would look like a change: stop it first.
    scanning = false;
    send(overlay, 'scan', false);
    await wait(150);
  }
  if (session.reference) {
    const now = await screenNow(display).catch(() => null);
    // The content may have moved a little (icons re-centred, a small scroll):
    // the mark follows it. If it is nowhere near, the mark is dropped.
    const found = now ? bestShift(session.reference, now, markCore(mark), ownAreas(display), 24, Math.round(now.height / 4)) : { diff: 0, dx: 0, dy: 0 };
    const diff = found.diff;
    if (diff <= STALE && (found.dx || found.dy)) {
      const fx = found.dx / now.width;
      const fy = found.dy / now.height;
      mark = { ...mark, x: mark.x + fx, y: mark.y + fy, ...(mark.points ? { points: mark.points.map(([x, y]) => [x + fx, y + fy]) } : {}) };
      console.log(`[judith] mark follows its content (${found.dx}, ${found.dy})`);
    }
    if (diff > STALE) {
      console.log(`[judith] mark dropped: the screen changed since Judith looked (${diff.toFixed(1)})`);
      if (process.env.JUDITH_DEBUG_DIR) {
        const save = (img, name) => writeFileSync(join(process.env.JUDITH_DEBUG_DIR, name), nativeImage.createFromBitmap(Buffer.from(img.data), { width: img.width, height: img.height }).toPNG());
        save(session.reference, 'reference.png');
        save(now, 'now.png');
        console.log('[judith] rect', JSON.stringify(markRect(mark)), 'own', JSON.stringify(ownAreas(display)));
      }
      send(bubble, 'stale');
      send(bubble, 'marked'); // nothing to wait for
      return;
    }
  }
  if (!overlay.isVisible()) {
    overlay.setBounds(bounds);
    overlay.showInactive();
  }
  // The ink that stays readable on what is under the mark.
  const ground = session.reference ?? (await screenNow(display).catch(() => null));
  const ink = inkFor(averageLuma(ground, markRect(mark, 0)));
  if (entry) entry.marks += 1;
  send(overlay, 'mark', { ...toPixels(mark, bounds), ink, seed: shownMarks.length + 1 + Math.round(mark.x * 997 + mark.y * 787) });
  shownMarks.push(mark);
  watchMarks(display);
}

// Marks stick to their content: when the page scrolls (or icons slide), they
// move with it; when the content is gone (other page, other window), they go.
function watchMarks(display) {
  stopWatching();
  const startedAt = Date.now();
  let baseline = null;
  // Wait for the drawing animation to settle, then take the baseline.
  watcher = setTimeout(async function tick() {
    if (!shownMarks.length) return;
    if (Date.now() - startedAt > MARK_LIFETIME_MS) return clearMarks();
    try {
      const now = await captureSmall(display);
      if (!baseline) baseline = now;
      else {
        const own = ownAreas(display);
        // Where did the first mark's content go? (up to ~a quarter of the screen vertically)
        const moved = bestShift(baseline, now, markCore(shownMarks[0]), own, 12, Math.round(now.height / 4));
        const fx = moved.dx / now.width;
        const fy = moved.dy / now.height;
        const shifted = (m) => ({ ...m, x: m.x + fx, y: m.y + fy });
        // Every mark must be found at that same shift.
        const allThere = moved.diff <= CHANGED && shownMarks.every((m, i) => i === 0 || regionDiff(baseline, now, markCore(m), own, moved.dx, moved.dy) <= CHANGED);
        if (!allThere) {
          console.log('[judith] marks cleared: their content is gone');
          return clearMarks();
        }
        if (moved.dx || moved.dy) {
          shownMarks = shownMarks.map((m) => ({ ...shifted(m), points: m.points?.map(([x, y]) => [x + fx, y + fy]) }));
          send(overlay, 'shift', { dx: fx * display.bounds.width, dy: fy * display.bounds.height });
          baseline = now;
        }
      }
    } catch {}
    if (shownMarks.length) watcher = setTimeout(tick, WATCH_EVERY_MS);
  }, 1200);
}

function stopWatching() {
  clearTimeout(watcher);
  watcher = null;
}

function clearMarks() {
  stopWatching();
  shownMarks = [];
  send(overlay, 'clear');
  // The frame of the zone the user drew stays.
  if (!session.zone && !zonePicking) overlay?.hide();
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
  if ((command.type === 'board' || command.type === 'note') && !config.board) return;
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
const QUIET_TOOLS = new Set(['Read', 'Glob', 'Grep', 'TodoWrite', 'ToolSearch', 'mcp__judith__find_apps', 'mcp__judith__approve', 'mcp__judith__look_at_screen']);
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
  journalTool(name);
  if (!config.board) return;
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
let lastHeardAt = null;
let lastAsk = null;
// The turn being answered, numbered by the notch's conversation manager.
// Everything sent to the notch carries it, so a cancelled turn is ignored.
let activeTurn = 0;
// The look_at_screen tool: capture, then a dashed scan while Judith reads it.
async function lookForJudith() {
  mark('look');
  const display = session.display ?? cursorDisplay();
  try {
    const shot = await look(display);
    session.reference = shot.small;
    overlay.setBounds(display.bounds);
    overlay.showInactive();
    scanning = true;
    send(overlay, 'scan', true);
    const zone = Boolean(session.frame);
    return { data: shot.data, mediaType: shot.mediaType, pointer: toZone(session.pointer, session.frame), zone };
  } catch (error) {
    console.error('[judith] look failed:', error.message);
    return {};
  }
}

// Where the seconds go: logged for each question.
let timeline = null;
function mark(step) {
  if (!timeline || timeline[step]) return;
  timeline[step] = Date.now();
  const at = (s) => (timeline[s] ? `${s} ${timeline[s] - timeline.ask} ms` : null);
  if (step === 'voice') {
    console.log(`[timing] ${['firstWord', 'firstLine', 'look', 'voice'].map(at).filter(Boolean).join(' · ')}${timeline.heard ? ` (spoken question ready ${timeline.ask - timeline.heard} ms after the end of speech)` : ''}`);
  }
}

// The diary of the week: one line per question, on this PC only
// (journal.jsonl in the user data folder), to learn what Judith is really used for.
let entry = null;
function journalTool(name) {
  entry?.tools.push(name.replace(/^mcp__judith__/, ''));
}
function journal(fields) {
  if (!config.journal || !entry) return;
  const line = { ...entry, ...fields, ms: Date.now() - entry.at, at: new Date(entry.at).toISOString() };
  entry = null;
  try {
    appendFileSync(join(app.getPath('userData'), 'journal.jsonl'), `${JSON.stringify(line)}\n`);
  } catch {}
}

async function ask(question, turn) {
  activeTurn = turn;
  entry = { at: Date.now(), question, spoken: Boolean(lastHeardAt && Date.now() - lastHeardAt < 15000), tools: [], marks: 0 };
  timeline = { ask: Date.now(), heard: lastHeardAt };
  turnLinks = new Map();
  openedCreation = false;
  await warmingUp;
  // The user may still be drawing the zone the question is about.
  if (zonePicking) await zonePicking;
  const display = session.display ?? cursorDisplay();
  session.display = display;
  clearMarks();
  // The question is about the screen ("explique ça", "où est…") or a zone
  // was drawn: the screenshot goes with it, one round trip less than
  // look_at_screen. alwaysLook: the old behaviour, a screenshot every time.
  let image = null;
  if (config.alwaysLook || session.zone || needsScreen(question)) {
    const shot = await lookForJudith();
    if (shot.data) image = shot;
  }

  // Script lines go to the notch as soon as they are complete.
  let commands = 0;
  const reader = createScriptReader((command) => {
    if (command.type === 'say') {
      // Links become cards; the voice says their title, never the URL.
      for (const link of findLinks(command.text, config.language)) addLink(link);
      command = { ...command, text: speakable(command.text, config.language) };
      if (!command.text) return;
    }
    // Coordinates of a zone screenshot → coordinates of the display.
    if (command.type === 'mark') command = fromZone(command, session.frame);
    commands += 1;
    mark('firstLine');
    send(bubble, 'cmd', { ...command, turn });
  });
  currentReader = reader;
  try {
    const result = await engine.ask(
      buildUserContent({
        question,
        image: image && { mediaType: image.mediaType, data: image.data },
        pointer: toZone(session.pointer, image ? session.frame : null),
        zone: Boolean(image && session.frame),
      }),
    );
    reader.finish(result.streamed || result.text);
    // A document or page was made but not opened: open the first one.
    const creation = [...turnLinks.values()].find((link) => link.creation);
    if (creation) openCreation(creation.url);
    console.log(`[judith] answered in ${(result.durationMs / 1000).toFixed(1)} s, ${commands} command(s)`);
    journal({ outcome: 'answered', commands, firstVoiceMs: timeline?.voice ? timeline.voice - timeline.ask : null });
  } catch (error) {
    if (!error.cancelled) send(bubble, 'error', { turn, message: error.message });
    journal({ outcome: error.cancelled ? 'cancelled' : 'error', error: error.cancelled ? undefined : error.message });
  } finally {
    if (currentReader === reader) currentReader = null;
    scanning = false;
    send(overlay, 'scan', false);
    send(bubble, 'answer', { turn });
  }
}

// X, or the user talks over Judith: stop Claude Code and what is on screen.
function cancelTurn(turn) {
  if (turn !== activeTurn) return;
  console.log(`[judith] turn ${turn} cancelled`);
  currentReader = null;
  engine.cancel();
  for (const id of [...approvals.keys()]) settleApproval(id, false);
  scanning = false;
  send(overlay, 'scan', false);
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
  // Windows needs it to show Judith's notifications (and to group her windows).
  app.setAppUserModelId('com.jeremi24.judith');
  startSpeech();
  startVoice();
  startReminders();

  setCaptureProtection(config.hideFromScreenRecordings);
  bubble = createBubble();
  overlay = createOverlay();
  board = createBoard();

  // Judith's tools run in an MCP server that Claude Code starts. Electron
  // itself runs it as plain Node, so no separate Node install is needed.
  const bridge = await startBridge({
    onApprove: requestApproval,
    onLook: lookForJudith,
    onCopyShot: copyScreenshot,
    onReminder: reminderTool,
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
    // Emotion tags only when the voice can act them.
    systemPrompt: buildSystemPrompt({ language: config.language, annotations: config.annotations, emotions: config.voice === 'fish', board: config.board }),
    // Speed: little thinking for a conversation, and Judith's tools loaded up
    // front (no ToolSearch round trip before looking at the screen).
    env: { ENABLE_TOOL_SEARCH: 'false' },
    extraArgs: [
      ...(config.effort ? ['--effort', config.effort] : []),
      '--mcp-config', mcpConfig,
      '--allowedTools', ALLOWED_TOOLS.join(','),
      '--permission-prompt-tool', 'mcp__judith__approve',
      // Claude Code's own scheduled prompts die with its session: reminders
      // go through Judith (set_reminder), which keeps them on disk.
      '--disallowedTools', 'CronCreate,CronDelete,CronList',
    ],
  });
  // The warm-up answer stays silent: no reader is listening yet.
  engine.on('delta', (text) => {
    if (currentReader) mark('firstWord');
    currentReader?.push(text);
  });
  engine.on('tool', (tool) => {
    console.log(`[judith] tool ${tool.name} ${JSON.stringify(tool.input).slice(0, 120)}`);
    send(bubble, 'tool', { turn: activeTurn, label: describeTool(tool.name, tool.input, config.language) });
    trackTool(tool);
    creationsIn(JSON.stringify(tool.input ?? {}));
    // Claude Code "opens" a creation in its own app: Judith opens the browser.
    if (tool.name === 'Artifact' && tool.input?.action === 'open' && isCreation(String(tool.input.url))) openCreation(tool.input.url);
  });
  engine.on('tool-result', (result) => {
    trackResult(result);
    creationsIn(result.output);
  });
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
  if (config.zoneShortcut && !globalShortcut.register(config.zoneShortcut, summonWithZone)) {
    console.error(`[judith] shortcut ${config.zoneShortcut} is already taken`);
  }

  ipcMain.handle('judith:ask', (_e, question, turn) => (lastAsk = ask(String(question), Number(turn))));
  ipcMain.on('judith:cancel', (_e, turn) => cancelTurn(Number(turn)));
  ipcMain.on('judith:clear-screen', () => {
    dropZone();
    clearMarks();
    scanning = false;
    send(overlay, 'scan', false);
  });
  ipcMain.handle('judith:transcribe', (_e, audio) => transcribe(audio));
  ipcMain.handle('judith:filter-heard', (_e, text, spoken) => {
    if (isGhost(text) || isEcho(text, spoken)) {
      console.log(`[judith] ignored what the mic heard: "${String(text).slice(0, 60)}"`);
      return '';
    }
    return text;
  });
  ipcMain.handle('judith:speak-start', (_e, text) => streamVoice(String(text)));
  ipcMain.on('judith:close', hide);
  ipcMain.on('judith:pick-zone', () => pickZone());
  ipcMain.on('judith:zone-selected', (_e, zone) => settleZone?.(zone && ['x1', 'y1', 'x2', 'y2'].every((k) => Number.isFinite(zone[k])) ? zone : null));
  ipcMain.on('judith:drop-zone', dropZone);
  ipcMain.on('judith:open-link', (_e, url) => /^https?:\/\//i.test(String(url)) && shell.openExternal(String(url)));
  ipcMain.on('judith:summon', summon);
  ipcMain.on('judith:summon-zone', summonWithZone);
  ipcMain.on('judith:show', (_e, command) => show(command));
  ipcMain.on('judith:marked', () => send(bubble, 'marked'));
  // The notch reports the end of speech and the first spoken sentence.
  ipcMain.on('judith:timing', (_e, step) => (step === 'heard' ? (lastHeardAt = Date.now()) : mark(step)));
  ipcMain.on('judith:approve', (_e, { id, allow }) => settleApproval(id, allow === true));
  ipcMain.on('judith:resize', (_e, size) => {
    const width = Math.min(720, Math.max(60, Math.ceil(size?.width ?? 0)));
    const height = Math.min(480, Math.max(40, Math.ceil(size?.height ?? 0)));
    bubbleAtRest = size?.atRest === true;
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
      // ScriptProcessorNode still works; its deprecation notice is just noise.
      if ((event.level === 'error' || event.level === 'warning') && !event.message.includes('ScriptProcessorNode')) {
        console.error('[page]', event.message);
      }
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
        const started = Date.now();
        question = await transcribe(decodeWav(readFileSync(wav)).samples);
        console.log(`[judith] heard "${question}" in ${((Date.now() - started) / 1000).toFixed(1)} s`);
      }
      await summon();
      // Asked through the notch, exactly like a typed question.
      send(bubble, 'ask', question);
      // JUDITH_DEMO_CANCEL_MS: press X after that delay.
      if (process.env.JUDITH_DEMO_CANCEL_MS) setTimeout(() => send(bubble, 'idle'), Number(process.env.JUDITH_DEMO_CANCEL_MS));
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
