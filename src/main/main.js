import { app, globalShortcut, ipcMain, Menu, nativeImage, protocol, screen, session as sessions, shell, Tray } from 'electron';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fork } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { startBridge } from './bridge.js';
import { configPath, loadConfig, saveConfig } from './config.js';
import { getKey, hasKey, setKey } from './secrets.js';
import { detectEngines } from './detect.js';
import { ensureVoice } from './models.js';
import { captureDisplay, captureSmall, captureThumb, captureZones } from './capture.js';
import { BOARD_WIDTH, BUBBLE_WIDTH, createBoard, createBubble, createOnboarding, createOverlay, setCaptureProtection, setNotchInteractive } from './windows.js';
import { chooseEngine, createEngine, ENGINES, PROVIDERS } from '../engine/engines.js';
import { cleanKey } from '../engine/api-errors.js';
import { buildSystemPrompt, buildUserContent, describeTool } from '../core/prompt.js';
import { toPixels } from '../core/annotations.js';
import { markBox, pickSnap, snapMark } from '../core/snap.js';
import { createEyes, findEyes } from './eyes.js';
import { createHands, findHands } from './hands.js';
import { runActions } from '../core/pilot.js';
import { averageLuma, bestShift, CHANGED, markCore, markRect, regionDiff, STALE } from '../core/pixels.js';
import { inkFor } from '../core/ink.js';
import { createScriptReader } from '../core/script.js';
import { isEcho, isGhost } from '../core/hallucinations.js';
import { decodeWav } from '../core/audio.js';
import { stripEmotions } from '../core/emotions.js';
import { needsScreen } from '../core/needs-screen.js';
import { findLinks, isCreation, speakable } from '../core/links.js';
import { MAX_ZONES, addZone, frameOf, fromZone, removeZone, toZone } from '../core/zone.js';
import { shortcutAction } from '../core/shortcut.js';
import { createVisualStore, FRAME_SCHEME, resolveFrame } from './frames.js';
import { AGENT_IDLE_MS, AGENT_NEXT, createAgent, createProgressWatch } from '../core/agent.js';

if (!app.requestSingleInstanceLock()) app.quit();

const config = loadConfig();
const root = join(import.meta.dirname, '..', '..');
// The installer adds a version with transparent rounded corners (tray, notifications).
const iconPath = [join(root, 'assets', 'icon-rounded.png'), join(root, 'assets', 'icon.png')].find(existsSync);
let bubble, overlay, board, tray, engine, warmingUp;
// Windows UI Automation, to snap marks onto the real controls (optional).
let eyes = null;

// Tools Judith may use without asking: opening things, reading, showing.
// Everything else (editing files, running commands) goes through the notch.
const ALLOWED_TOOLS = [
  'mcp__judith__look_at_screen',
  'mcp__judith__show_visual',
  'mcp__judith__show_scene',
  'Read',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  // Visual explanations Claude Code makes with the user's own tools: artifacts
  // (pages, diagrams) and documents. They publish content; they do not touch
  // the computer. Judith shows them as a card and opens them in the browser.
  'Artifact',
  'mcp__claude_ai_Claude_Docs',
];
// Judith explains and points; she never acts on the computer. Tools that
// change something are refused outright (headless Claude Code would refuse
// any tool not allowed above anyway; this list makes it explicit).
const DENIED_TOOLS = ['Bash', 'PowerShell', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'CronCreate', 'CronDelete', 'CronList'];

// The display Judith works on, and a tiny copy of the screen as she last saw
// it (to notice when it changes under her marks).
let session = { display: null, reference: null, zones: [], thumbs: [], frames: [] };

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
    if (session.zones?.length || shownMarks.length) showOverlay();
  }
}

// The overlay is shown without focus; the notch (and its X) must stay above it,
// or the full-screen overlay would sit over the buttons.
function showOverlay() {
  overlay.showInactive();
  bubble.moveTop();
}

// With zones drawn by the user, only those zones are sent (one image each):
// Claude's coordinates are then fractions of a zone (session.frames) until
// the next look. The tiny reference copy is taken the same way as the later
// checks, so only real changes count.
async function look(display) {
  const zones = session.zones ?? [];
  session.frames = zones;
  return withoutJudith(async () => {
    if (!zones.length) return { ...(await captureDisplay(display)), small: await captureSmall(display) };
    const { images } = await captureZones(display, zones);
    return { images, mediaType: images[0].mediaType, data: images[0].data, small: await captureSmall(display) };
  });
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
  session = { display, reference: null, pointer, zones: [], thumbs: [], frames: [] };
  publishZones();

  placeBubble(display);
  bubble.show();
  bubble.focus();
  const ears = liveEars();
  // No conversation in demo mode: nobody is there to answer.
  // Push to talk: listening ends only on the shortcut (or Stop), so music and
  // voices around never decide when the question ends; no follow-up listening.
  const push = config.listenMode === 'push';
  const conversation = config.conversation && !push && !process.env.JUDITH_DEMO;
  send(bubble, 'focus', { conversation, interruptions: config.interruptions && !push, stt: ears, push });
}

// ----- the zones: the user draws the parts of the screen to explain -----
// The overlay catches the mouse while the user drags a rectangle (Escape or
// a simple click cancels); then it only shows the zone's frame. Judith keeps
// listening meanwhile: "c'est quoi ça ?" can be said while drawing.
// A second zone does not replace the first: the first stays, numbered, as a
// thumbnail in the notch, and so on up to MAX_ZONES. The conversation ending
// (or the thumbnail's cross) removes them.
let zonePicking = null;
let settleZone = null;

// The zones go to the overlay (numbered frames) and to the notch (thumbnails).
function publishZones() {
  send(overlay, 'zones', session.zones ?? []);
  send(bubble, 'zones', (session.zones ?? []).map((zone, i) => ({ n: i + 1, thumb: session.thumbs?.[i] ?? '' })));
}

// A small picture of the zone just drawn, for its thumbnail.
async function makeThumb(zone) {
  const display = session.display ?? cursorDisplay();
  try {
    const thumb = await withoutJudith(() => captureThumb(display, zone));
    const i = session.zones.indexOf(zone);
    if (i >= 0) {
      session.thumbs[i] = thumb;
      publishZones();
    }
  } catch (error) {
    console.error('[judith] thumbnail failed:', error.message);
  }
}

function pickZone() {
  if (zonePicking) return zonePicking;
  if ((session.zones ?? []).length >= MAX_ZONES) {
    send(bubble, 'notice', `${MAX_ZONES} zones au maximum : retire-en une avec sa croix.`);
    return Promise.resolve(null);
  }
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
      const zones = addZone(session.zones ?? [], zone);
      const added = zones.length > (session.zones ?? []).length;
      session.zones = zones;
      if (added) session.thumbs = [...(session.thumbs ?? []), ''];
      publishZones();
      if (!session.zones.length && !shownMarks.length) overlay.hide();
      if (zone) console.log(`[judith] zone ${session.zones.length}: ${JSON.stringify(Object.values(zone).map((v) => +v.toFixed(3)))}`);
      bubble.focus();
      resolve(zone);
      if (added) makeThumb(zone);
    };
  });
  return zonePicking;
}

// The conversation is over (or cancelled): the zones go, the marks stay.
function dropZone() {
  if (settleZone) settleZone(null);
  if (!session.zones?.length) return;
  session.zones = [];
  session.thumbs = [];
  publishZones();
  if (!shownMarks.length) overlay.hide();
}

// The cross of a thumbnail: that zone goes, the others are renumbered.
function dropOneZone(index) {
  if (!Number.isInteger(index) || index < 0 || index >= (session.zones?.length ?? 0)) return;
  session.zones = removeZone(session.zones, index);
  session.thumbs = removeZone(session.thumbs ?? [], index);
  publishZones();
  if (!session.zones.length && !shownMarks.length) overlay.hide();
}

// The zone shortcut: summons Judith and draws a zone; during a conversation it
// adds a zone to the ones already drawn.
function summonWithZone() {
  if (notchState !== 'none' && notchState !== 'settings' && session.display) return void pickZone();
  summon();
  pickZone();
}

// ----- what Claude creates: artifacts, visuals, documents, pages -----
// Claude Code would show them in its own app; Judith has no such pane, so
// she shows a card in the notch and opens the creation in the browser.
// Links named in an answer become cards too (opened by the user's click).
let turnLinks = new Map();
let openedCreation = false;
// titled: the title comes from the answer ("[Mon schéma](…)"), better than the
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
// The window is a fixed transparent stage: it is only moved, never resized.
// At rest the pill sits a few pixels below the edge (bubble.css), and the
// stage lets clicks through around it, so tabs and title bars stay clickable.
function placeBubble(display) {
  const { x, y, width: screenWidth } = display.bounds;
  bubble.setPosition(Math.round(x + (screenWidth - BUBBLE_WIDTH) / 2), y);
}
// The notch's state as the page shows it (none, listening, thinking, speaking).
let notchState = 'none';

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
// The notch's visible rect inside its (bigger, transparent) window, sent by the
// notch itself: the rest of that window shows the user's apps.
let notchBox = null;
function ownAreas(display) {
  const { x, y, width, height } = display.bounds;
  return [bubble, board]
    .filter((w) => w.isVisible())
    .map((w) => {
      const b = w.getBounds();
      return w === bubble && notchBox ? { x: b.x + notchBox.x, y: b.y + notchBox.y, width: notchBox.width, height: notchBox.height } : b;
    })
    .map((b) => ({ x1: (b.x - x) / width, y1: (b.y - y) / height, x2: (b.x + b.width - x) / width, y2: (b.y + b.height - y) / height }));
}

// A ring or box lands on the real control under it: the model's box is only
// approximate (often ~30 px off on small icons); Windows knows the exact one.
async function snapToControl(mark, display) {
  if (!eyes?.available || (mark.shape !== 'ring' && mark.shape !== 'box') || !(mark.w > 0 && mark.h > 0)) return mark;
  const { bounds } = display;
  const onWindows = process.platform === 'win32';
  const dip = { x: Math.round(bounds.x + mark.x * bounds.width), y: Math.round(bounds.y + mark.y * bounds.height) };
  const point = onWindows ? screen.dipToScreenPoint(dip) : dip;
  const elements = await eyes.around(point.x, point.y);
  if (!elements?.length) return mark;
  const candidates = elements.map((e) => {
    const r = onWindows ? screen.screenToDipRect(null, { x: e.x, y: e.y, width: e.w, height: e.h }) : { x: e.x, y: e.y, width: e.w, height: e.h };
    return {
      name: e.name,
      type: e.type,
      rect: { x1: (r.x - bounds.x) / bounds.width, y1: (r.y - bounds.y) / bounds.height, x2: (r.x + r.width - bounds.x) / bounds.width, y2: (r.y + r.height - bounds.y) / bounds.height },
    };
  });
  const rect = pickSnap(markBox(mark), mark.label, candidates);
  if (rect) console.log(`[judith] mark "${mark.label}" snapped onto the real control`);
  return snapMark(mark, rect);
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
  mark = await snapToControl(mark, display);
  if (!overlay.isVisible()) {
    overlay.setBounds(bounds);
    showOverlay();
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
  if (!session.zones?.length && !zonePicking && !piloting) overlay?.hide();
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
  showVisualFrame(name, html);
}

// ----- 3D scenes (show_scene) -----
// The board runs the model's code in a sandboxed frame and says whether it
// worked; the tool waits for that, so the model can fix its code or explain
// with words and marks instead. Code that hangs (an endless loop) freezes the
// board: after SCENE_TIMEOUT its renderer is crashed and reloaded.
const SCENE_TIMEOUT = 5000;
let sceneWait = null;
let sceneCount = 0;
function showScene(title, code) {
  sceneWait?.resolve({ ok: false, error: 'replaced by a newer scene' });
  const id = ++sceneCount;
  showBoard();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (sceneWait?.id !== id) return;
      sceneWait = null;
      console.warn('[judith] 3D scene timed out: reloading the board');
      board.webContents.forcefullyCrashRenderer();
      board.reload();
      resolve({ ok: false, error: `The scene did not answer within ${SCENE_TIMEOUT / 1000} s (endless loop or too heavy) and was stopped.` });
    }, SCENE_TIMEOUT);
    sceneWait = {
      id,
      resolve: (result) => {
        clearTimeout(timer);
        sceneWait = null;
        resolve(result);
      },
    };
    send(board, 'scene', { id, title, code, seenImage: lastSeen });
  });
}

// What Judith's script asks to show, when its sentence starts.
function show(command) {
  if (command.type === 'scene') return send(board, 'scene-step', { step: command.step });
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
const QUIET_TOOLS = new Set(['Read', 'Glob', 'Grep', 'TodoWrite', 'ToolSearch', 'mcp__judith__look_at_screen']);
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
// lastSeen: that screenshot, shown as "Ce que j'ai vu" next to a 3D scene.
let lastSeen = null;
async function lookForJudith() {
  mark('look');
  const display = session.display ?? cursorDisplay();
  try {
    const shot = await look(display);
    session.reference = shot.small;
    lastSeen = `data:${shot.mediaType};base64,${shot.data}`;
    overlay.setBounds(display.bounds);
    showOverlay();
    scanning = true;
    send(overlay, 'scan', true);
    const frames = session.frames ?? [];
    return {
      data: shot.data,
      mediaType: shot.mediaType,
      // Several zones: one image each (the first is also data / mediaType).
      images: shot.images ?? [{ data: shot.data, mediaType: shot.mediaType }],
      pointer: frames.length > 1 ? null : toZone(session.pointer, frames[0] ?? null),
      zone: frames.length > 0,
      zones: frames.length,
    };
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

// ----- agent mode, guided: step, wait for the user to do it, next step -----
const agent = createAgent({ canAct: () => Boolean(config.agentHands && hands?.available) });
let agentWatch = null;
// Often enough that the next step comes soon after the user acts: with the
// watch's 2 learning and 2 settling frames, 0.8 s each.
const AGENT_WATCH_EVERY_MS = 400;

function agentState(extra = {}) {
  send(bubble, 'agent', { active: agent.active, step: agent.step, max: agent.maxSteps, ...extra });
}

function stopAgent(extra = {}) {
  clearTimeout(agentWatch);
  agentWatch = null;
  endPiloting();
  if (!agent.active) return;
  console.log(`[judith] agent mode ends at step ${agent.step}${extra.done ? ' (goal reached)' : ''}`);
  agent.stop();
  agentState(extra);
}

// After a step: watch the screen until the user has done it (it changed, then
// settled), then the notch asks the next step. Judith's own voice and windows
// never count; nothing is watched while she thinks or speaks.
function waitForUser(display) {
  clearTimeout(agentWatch);
  const watch = createProgressWatch();
  const since = Date.now();
  agentWatch = setTimeout(async function tick() {
    if (!agent.active) return;
    if (Date.now() - since > AGENT_IDLE_MS) return stopAgent({ timeout: true });
    if (notchState !== 'thinking' && notchState !== 'speaking') {
      try {
        const progress = watch.push(await captureSmall(display), ownAreas(display));
        if (progress === 'changed') {
          if (agent.step >= agent.maxSteps) return stopAgent({ limit: true });
          agentWatch = null;
          console.log('[judith] agent mode: the screen changed, next step');
          return send(bubble, 'agent-next', { question: AGENT_NEXT, step: agent.step + 1, max: agent.maxSteps });
        }
      } catch {}
    }
    agentWatch = setTimeout(tick, AGENT_WATCH_EVERY_MS);
  }, AGENT_WATCH_EVERY_MS);
}

// ----- agent mode, autonomous: Judith acts herself, within the guardrails -----
// Opt-in (config.agentHands), with the "hands" companion. While she pilots:
// a frame around the screen and a banner say so; Ctrl+Alt+Escape, X, Esc or
// moving the mouse stop her at once; sensitive actions wait for "Vas-y".
let hands = null;
const STOP_SHORTCUT = 'Control+Alt+Escape';
let piloting = false;
let pilotAborted = false;
let pilot = { count: 0, lastControl: null };
let lastActPoint = null;

function startPiloting() {
  if (piloting) return;
  piloting = true;
  pilotAborted = false;
  pilot = { count: 0, lastControl: null };
  hands.reset();
  globalShortcut.register(STOP_SHORTCUT, () => {
    console.log('[judith] pilot stopped by the shortcut');
    send(bubble, 'cancel-all');
    stopAgent({ stopped: true });
  });
  const display = session.display ?? cursorDisplay();
  overlay.setBounds(display.bounds);
  showOverlay();
  send(overlay, 'piloting', true);
}

function endPiloting() {
  if (!piloting) return;
  piloting = false;
  pilotAborted = true; // an action still running is the last one
  answerConfirm?.(false);
  globalShortcut.unregister(STOP_SHORTCUT);
  send(overlay, 'piloting', false);
  if (!shownMarks.length && !session.zones?.length && !zonePicking) overlay.hide();
}

// The notch asks "Vas-y / Non" for a sensitive action (30 s, then no).
let answerConfirm = null;
function askConfirmation(reason) {
  answerConfirm?.(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => done(false), 30_000);
    const done = (yes) => {
      clearTimeout(timer);
      answerConfirm = null;
      send(bubble, 'confirm', null);
      resolve(Boolean(yes) && !pilotAborted);
    };
    answerConfirm = done;
    send(bubble, 'confirm', { reason });
  });
}

// A point of the model's screenshot → display fractions and physical pixels.
function actPoint(action, display) {
  const p = fromZone({ x: action.x, y: action.y, w: 0, h: 0 }, frameOf(session.frames, action.zone));
  const { bounds } = display;
  const dip = { x: Math.round(bounds.x + p.x * bounds.width), y: Math.round(bounds.y + p.y * bounds.height) };
  return { fraction: p, physical: process.platform === 'win32' ? screen.dipToScreenPoint(dip) : dip };
}

async function runPilot(actions, display) {
  startPiloting();
  const result = await runActions(
    actions,
    {
      async locate(action) {
        if (action.action === 'click' || action.action === 'scroll') {
          const { fraction, physical } = actPoint(action, display);
          const onJudith = ownAreas(display).some((r) => fraction.x >= r.x1 && fraction.x <= r.x2 && fraction.y >= r.y1 && fraction.y <= r.y2);
          const [app, elements] = await Promise.all([hands.at(physical.x, physical.y), eyes?.available ? eyes.around(physical.x, physical.y) : null]);
          return { app: app.error ? null : app, control: elements?.[0] ?? null, onJudith, point: physical, fraction };
        }
        // Keys and text go to the app in the foreground.
        const app = await hands.foreground();
        return { app: app.error ? null : app, control: null, onJudith: false };
      },
      confirm: (reason) => askConfirmation(reason),
      async show(action, target) {
        if (!target.fraction) return;
        // Where she is about to click: the user sees it coming.
        send(overlay, 'mark', { ...toPixels({ type: 'mark', shape: 'ring', x: target.fraction.x, y: target.fraction.y, w: 0.028, h: 0.045, label: action.label ?? '' }, display.bounds), ink: 'dark', seed: pilot.count + 1 });
        await wait(450);
      },
      async perform(action, target) {
        if (pilotAborted) return { error: 'user' };
        console.log(`[judith] act ${action.action} ${action.label ?? action.combo ?? ''}`.trim());
        if (action.action === 'click') lastActPoint = target.point;
        if (action.action === 'click') return hands.click(target.point.x, target.point.y, action.button);
        if (action.action === 'scroll') return hands.scroll(target.point.x, target.point.y, action.notches);
        if (action.action === 'type') return hands.type(action.text);
        return hands.key(action.combo);
      },
    },
    pilot,
  );
  send(overlay, 'clear');
  return result;
}

async function ask(question, turn) {
  activeTurn = turn;
  clearTimeout(agentWatch);
  agentWatch = null;
  // Agent mode: the special word starts it; while it runs, the user's answers
  // and the screen changes (AGENT_NEXT) become its next steps.
  const wasAgent = agent.active;
  const asked = question === AGENT_NEXT ? agent.next() : agent.question(question);
  // The step limit was reached: the loop is over (the agent stopped itself).
  if (wasAgent && !agent.active) agentState({ limit: true });
  if (asked == null) {
    // "Non" to the offer to guide: no question for the model.
    if (agent.declined) send(bubble, 'cmd', { type: 'say', text: "D'accord, je reste dans le coin.", turn });
    return send(bubble, 'answer', { turn });
  }
  const inAgent = agent.active;
  if (inAgent) agentState();
  let goalReached = false;
  const actions = [];
  let proposed = null; // the model offers to guide a task in several steps
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
  // Engines other than Claude Code cannot call look_at_screen: they always get it.
  if (config.alwaysLook || !engine.canLook || session.zones?.length || inAgent || needsScreen(question)) {
    const shot = await lookForJudith();
    if (shot.data) image = shot;
  }

  // Script lines go to the notch as soon as they are complete.
  let commands = 0;
  let currentZone = 1; // the zone the drawing lines are in (script line "zone n")
  const reader = createScriptReader((command) => {
    if (command.type === 'propose') {
      if (!agent.active) proposed = command.goal;
      return;
    }
    if (command.type === 'zone') {
      // Several zones: the drawing lines that follow are in zone n.
      currentZone = command.n;
      return;
    }
    if (command.type === 'act') {
      // Only in autonomous agent mode; otherwise an action is never done.
      if (agent.autonomous) actions.push({ ...command, zone: currentZone });
      return;
    }
    if (command.type === 'done') {
      goalReached = true;
      if (!command.text) return;
      command = { type: 'say', text: command.text };
    }
    if (command.type === 'say') {
      // Links become cards; the voice says their title, never the URL.
      for (const link of findLinks(command.text, config.language)) addLink(link);
      command = { ...command, text: speakable(command.text, config.language) };
      if (!command.text) return;
    }
    // Coordinates of a zone screenshot → coordinates of the display.
    if (command.type === 'mark') command = fromZone(command, frameOf(session.frames, currentZone));
    commands += 1;
    mark('firstLine');
    send(bubble, 'cmd', { ...command, turn });
  });
  currentReader = reader;
  try {
    const result = await engine.ask(
      buildUserContent({
        question: asked,
        images: image?.images?.map(({ mediaType, data }) => ({ mediaType, data })),
        pointer: image && (session.frames?.length ?? 0) <= 1 ? toZone(session.pointer, session.frames?.[0] ?? null) : null,
        zone: Boolean(image && session.frames?.length),
      }),
    );
    reader.finish(result.streamed || result.text);
    // A visual or document was made but not opened: open the first one.
    const creation = [...turnLinks.values()].find((link) => link.creation);
    if (creation) openCreation(creation.url);
    console.log(`[judith] answered in ${(result.durationMs / 1000).toFixed(1)} s, ${commands} command(s)`);
    journal({ outcome: 'answered', commands, firstVoiceMs: timeline?.voice ? timeline.voice - timeline.ask : null });
    // A task in several steps: "Je te suis jusqu'au bout ?" (the voice asks it,
    // the notch shows Oui / Non; a spoken "oui" works too).
    if (!inAgent && proposed && agent.offer(proposed)) send(bubble, 'offer', { goal: proposed });
    if (inAgent && goalReached) stopAgent({ done: true });
    else if (inAgent && agent.autonomous && actions.length && turn === activeTurn) {
      const result = await runPilot(actions, display);
      if (result.stopped) stopAgent({ stopped: true, reason: result.reason });
      else if (agent.active) {
        // Let the screen react, then the next step.
        await wait(1200);
        if (agent.active && agent.step >= agent.maxSteps) stopAgent({ limit: true });
        else if (agent.active && turn === activeTurn) send(bubble, 'agent-next', { question: AGENT_NEXT, step: agent.step + 1, max: agent.maxSteps });
      }
    } else if (inAgent) waitForUser(display);
  } catch (error) {
    if (!error.cancelled) {
      send(bubble, 'error', { turn, message: error.message });
      stopAgent();
    }
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
  scanning = false;
  send(overlay, 'scan', false);
}

// ----- the engine: Claude Code, another agent, or a model with an API key -----
let claudeArgs = [];
let available = []; // engines installed on this PC
let engineKind = null;

// Everything an engine needs, from the settings. overrides: the settings being
// tested in the notch before they are saved.
function engineOptions(kind, overrides = {}) {
  const settings = { ...config, ...overrides };
  const canLook = kind === 'claude-code';
  return {
    cwd: settings.workingDirectory,
    // Emotion tags only when the voice can act them.
    systemPrompt: buildSystemPrompt({ language: settings.language, annotations: settings.annotations, emotions: settings.voice === 'fish', board: settings.board, canLook }),
    // Speed: little thinking for a conversation, and Judith's tools loaded up
    // front (no ToolSearch round trip before looking at the screen).
    claude: { claudePath: settings.claudePath, model: settings.model, extraArgs: claudeArgs, env: { ENABLE_TOOL_SEARCH: 'false' } },
    api: { provider: settings.apiProvider, model: settings.apiModel, baseUrl: settings.apiBaseUrl, key: overrides.apiKey || getKey(settings.apiProvider) },
    agentModel: settings.agentModel,
  };
}

function startEngine() {
  engine?.stop();
  engineKind = chooseEngine({ configured: config.engine, available, hasKey: hasKey(config.apiProvider) });
  console.log(`[judith] engine: ${engineKind} (configured: ${config.engine}, installed: ${available.join(', ') || 'none'})`);
  engine = createEngine(engineKind, engineOptions(engineKind));
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
  engine.on('log', (text) => console.error(`[${engineKind}]`, text.trim()));
  // Claude Code is kept warm: start it and load its context now, so the first
  // real question is fast. Other engines start per question (and a warm-up
  // would cost the user API credits for nothing).
  warmingUp =
    engineKind === 'claude-code'
      ? engine.ask([{ type: 'text', text: 'Réponds seulement : say prête.' }]).catch((error) => console.error('[judith] warm-up failed:', error.message))
      : Promise.resolve();
}

// What the settings panel shows.
function engineSettings() {
  return {
    engine: engineKind,
    configured: config.engine,
    engines: Object.entries(ENGINES).map(([id, e]) => ({ id, label: e.label, memory: e.memory, installed: id === 'api' || available.includes(id) })),
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, model: p.models[0]?.id ?? '', models: p.models, free: Boolean(p.free), freeNote: p.freeNote ?? '', keyPrefix: p.keyPrefix ?? '', keyUrl: p.keyUrl, hasKey: hasKey(id) })),
    apiProvider: config.apiProvider,
    apiModel: config.apiModel,
    agentModel: config.agentModel,
    agentHands: config.agentHands,
    handsAvailable: Boolean(hands?.available),
  };
}

const SETTING_KEYS = ['engine', 'apiProvider', 'apiModel', 'apiBaseUrl', 'agentModel'];
function pickSettings(input = {}) {
  const out = {};
  for (const key of SETTING_KEYS) if (typeof input[key] === 'string') out[key] = input[key].trim();
  if (out.engine && out.engine !== 'auto' && !ENGINES[out.engine]) throw new Error(`Unknown engine: ${out.engine}`);
  if (out.apiProvider && !PROVIDERS[out.apiProvider]) throw new Error(`Unknown provider: ${out.apiProvider}`);
  if (typeof input.agentHands === 'boolean') out.agentHands = input.agentHands;
  // A model name belongs to one provider: another provider starts from its own default.
  if (out.apiProvider && out.apiProvider !== config.apiProvider && out.apiModel === undefined) out.apiModel = '';
  return out;
}

// A 1x1 white PNG: the test checks that the engine answers AND accepts an image.
const TEST_IMAGE = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
async function testEngine(input) {
  const settings = pickSettings(input);
  const kind = settings.engine && settings.engine !== 'auto' ? settings.engine : engineKind;
  const apiKey = typeof input?.apiKey === 'string' ? cleanKey(input.apiKey) : '';
  const probe = createEngine(kind, engineOptions(kind, { ...settings, apiKey }));
  const startedAt = Date.now();
  const timer = setTimeout(() => probe.cancel(), 45000);
  try {
    await probe.ask([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: TEST_IMAGE } },
      { type: 'text', text: 'Test de connexion. Réponds seulement : say ok' },
    ]);
    return { ok: true, ms: Date.now() - startedAt };
  } catch (error) {
    return { ok: false, error: error.cancelled ? 'Pas de réponse en 45 s.' : error.message };
  } finally {
    clearTimeout(timer);
    probe.stop();
  }
}

function saveEngineSettings(input) {
  const settings = pickSettings(input);
  const apiKey = typeof input?.apiKey === 'string' ? cleanKey(input.apiKey) : '';
  if (apiKey) setKey(settings.apiProvider || config.apiProvider, apiKey);
  Object.assign(config, settings);
  saveConfig(settings);
  startEngine();
  return engineSettings();
}

// The same shortcut summons Judith and, while she thinks or speaks, stops her.
function onShortcut() {
  if (shortcutAction(notchState) === 'cancel') send(bubble, 'cancel-all');
  else summon();
}

// ----- the welcome window: first start, or "Revoir l'accueil" in the tray -----
// What Judith does, then the engine, listening and shortcuts. Keys are optional.
const SHORTCUT_CHOICES = ['Control+Alt+J', 'Control+Shift+Space', 'Alt+Shift+J'];
let onboarding = null;
const onboardedPath = () => join(app.getPath('userData'), 'onboarded');
function openOnboarding() {
  if (onboarding && !onboarding.isDestroyed()) return onboarding.focus();
  onboarding = createOnboarding(iconPath);
  onboarding.on('closed', () => (onboarding = null));
  onboarding.webContents.on('console-message', (event) => event.level === 'error' && console.error('[onboarding]', event.message));
}
function onboardingStatus() {
  return {
    shortcut: config.shortcut,
    zoneShortcut: config.zoneShortcut,
    shortcuts: [...new Set([config.shortcut, ...SHORTCUT_CHOICES])],
    listenMode: config.listenMode,
    speechInput: config.speechInput,
    deepgramSet: Boolean(config.deepgramKey),
    packaged: app.isPackaged,
    startWithWindows: app.isPackaged && app.getLoginItemSettings().openAtLogin,
  };
}
// A new summon shortcut, or the old one back if another app holds it.
function setShortcut(next) {
  if (!next || next === config.shortcut) return true;
  globalShortcut.unregister(config.shortcut);
  if (!globalShortcut.register(next, onShortcut)) {
    globalShortcut.register(config.shortcut, onShortcut);
    return false;
  }
  config.shortcut = next;
  saveConfig({ shortcut: next });
  return true;
}
function saveOnboarding(input = {}) {
  const changes = {};
  if (input.listenMode === 'auto' || input.listenMode === 'push') changes.listenMode = input.listenMode;
  if (input.speechInput === 'whisper' || input.speechInput === 'deepgram') changes.speechInput = input.speechInput;
  if (typeof input.deepgramKey === 'string' && input.deepgramKey.trim()) changes.deepgramKey = input.deepgramKey.trim();
  if (Object.keys(changes).length) {
    Object.assign(config, changes);
    saveConfig(changes);
  }
  if (typeof input.startWithWindows === 'boolean' && app.isPackaged) app.setLoginItemSettings({ openAtLogin: input.startWithWindows });
  const shortcutOk = typeof input.shortcut === 'string' ? setShortcut(input.shortcut) : true;
  buildTrayMenu();
  return { ok: shortcutOk, error: shortcutOk ? null : `Le raccourci ${input.shortcut} est déjà pris par une autre appli.`, status: onboardingStatus() };
}
function finishOnboarding({ tryNow = false } = {}) {
  writeFileSync(onboardedPath(), new Date().toISOString());
  onboarding?.close();
  if (tryNow) setTimeout(summon, 500);
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
      { label: "Revoir l'accueil", click: openOnboarding },
      {
        label: 'Appuyer pour parler (lieu bruyant)',
        type: 'checkbox',
        checked: config.listenMode === 'push',
        click: (item) => {
          config.listenMode = item.checked ? 'push' : 'auto';
          saveConfig({ listenMode: config.listenMode });
        },
      },
      { type: 'separator' },
      ...(app.isPackaged
        ? [
            {
              label: 'Démarrer avec Windows',
              type: 'checkbox',
              checked: app.getLoginItemSettings().openAtLogin,
              click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
            },
          ]
        : []),
      { label: 'Quitter', role: 'quit' },
    ]),
  );
}

// ----- the installed app (Judith-Setup.exe) -----
// Windows ties notifications and pinning to this id: the Start menu
// shortcut must carry it. The first start of a new version also makes
// Judith start with Windows (the tray menu turns it off).
const APP_ID = 'com.jeremi24.judith';
function settleInstalledApp() {
  if (!app.isPackaged) return;
  // Installed by the Setup (its Start menu shortcut is there), not a copy
  // being tried from dist/: only then does Judith start with Windows.
  const shortcut = join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Judith.lnk');
  if (!existsSync(shortcut)) return;
  shell.writeShortcutLink(shortcut, 'update', { appUserModelId: APP_ID });
  const marker = join(app.getPath('userData'), 'installed-version');
  const known = existsSync(marker) ? readFileSync(marker, 'utf8').trim() : null;
  if (known !== app.getVersion()) {
    if (known === null) app.setLoginItemSettings({ openAtLogin: true });
    writeFileSync(marker, app.getVersion());
  }
}

// The board's sandboxed frames (visuals, 3D scenes) come from judith-frame://,
// each with its own CSP (src/main/frames.js). Must be declared before ready.
protocol.registerSchemesAsPrivileged([{ scheme: FRAME_SCHEME, privileges: { standard: true, secure: true } }]);
const visuals = createVisualStore();
function handleFrames() {
  protocol.handle(FRAME_SCHEME, (request) => {
    const found = resolveFrame(request.url, { root, visuals });
    if (found.status !== 200) return new Response('', { status: found.status });
    const body = found.file ? readFileSync(found.file) : found.body;
    return new Response(body, { status: 200, headers: { 'content-type': found.type, 'content-security-policy': found.csp } });
  });
}
// An HTML visual in the board's frame.
function showVisualFrame(title, html) {
  showBoard();
  send(board, 'visual', { title, src: visuals.add(html) });
}

app.whenReady().then(async () => {
  // Judith's own pages may use the microphone; nothing else is granted.
  const allowMedia = (permission) => permission === 'media';
  sessions.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowMedia(permission)));
  sessions.defaultSession.setPermissionCheckHandler((_wc, permission) => allowMedia(permission));
  // Windows needs it to show Judith's notifications (and to group her windows).
  app.setAppUserModelId(APP_ID);
  settleInstalledApp();
  startSpeech();
  startVoice();

  setCaptureProtection(config.hideFromScreenRecordings);
  handleFrames();
  bubble = createBubble();
  overlay = createOverlay();
  board = createBoard();

  // Judith's tools run in an MCP server that Claude Code starts. Electron
  // itself runs it as plain Node, so no separate Node install is needed.
  const bridge = await startBridge({
    onLook: lookForJudith,
    onVisual: showVisualFrame,
    onScene: showScene,
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

  eyes = createEyes({ exe: process.platform === 'win32' ? findEyes(root) : null, log: (text) => console.log(`[eyes] ${text}`) });
  console.log(`[judith] eyes (UI Automation): ${eyes.available ? 'on' : 'off, marks keep the model position'}`);
  hands = createHands({ exe: process.platform === 'win32' ? findHands(root) : null, log: (text) => console.log(`[hands] ${text}`) });
  console.log(`[judith] hands (autonomous agent mode): ${hands.available ? (config.agentHands ? 'on' : 'installed, off in the settings') : 'not installed'}`);
  claudeArgs = [
    ...(config.effort ? ['--effort', config.effort] : []),
    '--mcp-config', mcpConfig,
    '--allowedTools', ALLOWED_TOOLS.join(','),
    '--disallowedTools', DENIED_TOOLS.join(','),
  ];
  available = await detectEngines(config.claudePath);
  startEngine();

  // The idle notch ("Judith ●") is always at the top of the screen. The page
  // may already be loaded by now (the engine detection above takes a few
  // seconds): then "did-finish-load" has passed and would never come.
  const showNotch = () => {
    placeBubble(cursorDisplay());
    bubble.showInactive();
  };
  if (bubble.webContents.isLoading()) bubble.webContents.once('did-finish-load', showNotch);
  else showNotch();

  tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }));
  tray.setToolTip('Judith');
  tray.on('click', summon);
  buildTrayMenu();

  if (!globalShortcut.register(config.shortcut, onShortcut)) {
    console.error(`[judith] shortcut ${config.shortcut} is already taken`);
  }
  if (config.zoneShortcut && !globalShortcut.register(config.zoneShortcut, summonWithZone)) {
    console.error(`[judith] shortcut ${config.zoneShortcut} is already taken`);
  }

  ipcMain.handle('judith:onboarding-status', () => onboardingStatus());
  ipcMain.handle('judith:onboarding-save', (_e, input) => saveOnboarding(input));
  ipcMain.on('judith:onboarding-done', (_e, info) => finishOnboarding(info ?? {}));
  // First start on this PC (or JUDITH_ONBOARDING=1 to see it again while testing).
  if (!existsSync(onboardedPath()) || process.env.JUDITH_ONBOARDING) openOnboarding();

  ipcMain.handle('judith:ask', (_e, question, turn) => (lastAsk = ask(String(question), Number(turn))));
  ipcMain.on('judith:cancel', (_e, turn) => cancelTurn(Number(turn)));
  ipcMain.on('judith:clear-screen', () => {
    // X, Esc, "arrête": agent mode ends too.
    stopAgent();
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
  ipcMain.on('judith:remove-zone', (_e, index) => dropOneZone(index));
  ipcMain.on('judith:open-link', (_e, url) => /^https?:\/\//i.test(String(url)) && shell.openExternal(String(url)));
  ipcMain.on('judith:summon', summon);
  ipcMain.on('judith:summon-zone', summonWithZone);
  ipcMain.on('judith:show', (_e, command) => show(command));
  ipcMain.on('judith:marked', () => send(bubble, 'marked'));
  // The notch reports the end of speech and the first spoken sentence.
  ipcMain.on('judith:timing', (_e, step) => (step === 'heard' ? (lastHeardAt = Date.now()) : mark(step)));
  // The pointer entered or left the notch: take the clicks, or let them through.
  ipcMain.on('judith:interactive', (_e, on) => setNotchInteractive(bubble, on === true));
  ipcMain.on('judith:notch-state', (_e, state) => (notchState = String(state)));
  // What the notch does with the user's presses, in the terminal log: if a
  // button "does nothing", this tells whether the press reached the page.
  ipcMain.on('judith:log', (_e, text) => console.log(`[notch] ${String(text).slice(0, 200)}`));
  // The settings panel in the notch: which engine answers Judith.
  ipcMain.handle('judith:settings-get', async () => {
    available = await detectEngines(config.claudePath); // something may have been installed since
    return engineSettings();
  });
  ipcMain.handle('judith:settings-test', (_e, input) => testEngine(input).catch((error) => ({ ok: false, error: error.message })));
  ipcMain.handle('judith:settings-save', (_e, input) => {
    try {
      return { ok: true, settings: saveEngineSettings(input) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  ipcMain.on('judith:open-path', (_e, path) => existsSync(path) && shell.openPath(path));
  ipcMain.on('judith:preview', (_e, path) => preview(String(path)));
  ipcMain.on('judith:confirm-answer', (_e, yes) => answerConfirm?.(yes === true));
  ipcMain.on('judith:notch-box', (_e, box) => {
    const ok = box && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(box[k]));
    notchBox = ok ? box : null;
  });
  ipcMain.on('judith:scene-result', (_e, result) => {
    if (sceneWait && result?.id === sceneWait.id) sceneWait.resolve({ ok: Boolean(result.ok), error: result.error });
  });
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
  eyes?.stop();
  hands?.stop();
  speech?.terminate();
  tts?.kill();
});
