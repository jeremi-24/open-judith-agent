// The notch. It shows the conversation and forwards events to the
// conversation manager, which alone decides what happens next.
import { t, translateDocument } from '../core/i18n.js';
import { createConversation } from '../core/conversation.js';
import { createEars } from './ears.js';
translateDocument(document);

const notch = document.querySelector('.notch');
const label = document.getElementById('label');
const doing = document.getElementById('doing');
const textBox = document.getElementById('text');
const steps = document.getElementById('steps');
const form = document.getElementById('form');
const question = document.getElementById('question');
const bars = document.querySelector('.bars');
const pauseButton = document.getElementById('pause');
const links = document.getElementById('links');
const zoneButton = document.getElementById('zone');
const voice = window.JudithVoice;
const api = window.judith;

// ----- display -----
const LABELS = { listening: t("J'écoute…"), thinking: t('Je réfléchis…'), speaking: t('Judith parle') };
const MOODS = { idle: 'listen', listening: 'listen', thinking: 'think', speaking: 'explain' };

// Tiny, safe markdown: escape everything, then **bold** and `code`.
// Emotion tags are for the voice only.
function render(text) {
  return String(text)
    .replace(/\s*\[[a-z][a-z '-]{0,30}\]\s*/gi, ' ')
    .trim()
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

let messageTimer = null;
// The question in the field was typed by the user (not written by the live transcription).
let typedByHand = false;
function showState(state, info = {}) {
  clearTimeout(messageTimer);
  // A message or an error is shown a few seconds, then the notch rests.
  const message = info.error ?? info.message;
  const shown = state === 'idle' && message ? 'speaking' : state;
  notch.dataset.state = shown === 'idle' ? 'none' : shown;
  api.notchState(notch.dataset.state);
  notch.dataset.mood = MOODS[state] ?? 'listen';
  if (LABELS[shown]) label.textContent = LABELS[shown];
  notch.classList.toggle('talking', shown === 'speaking' && !message && !info.done && voice.speaking);

  if (state === 'listening') {
    typedByHand = false;
    question.value = info.partial ?? '';
    question.placeholder = info.followUp ? t('Autre chose ? Je t’écoute…') : info.continuation ? t('Je t’écoute, continue…') : t('Parle, ou écris ta question…');
    question.focus();
  }
  if (state === 'thinking') doing.textContent = info.heard ? `« ${info.heard} »` : t('Je réfléchis…');
  if (message) {
    textBox.innerHTML = render(message);
    textBox.classList.toggle('error', Boolean(info.error));
    messageTimer = setTimeout(() => notch.dataset.state === 'speaking' && conversation.state === 'idle' && showState('idle'), 4000);
  }
  if (state === 'idle') {
    // The conversation is over: the zone the user drew goes with it.
    api.dropZone();
    if (!message) ears.close();
  }
}

// ----- the answer: spoken sentences, steps and drawings -----
let lastSay = null; // the last sentence queued, until it starts

// She talks and draws at the same time, topic after topic: the drawings
// written before a sentence belong to it, and her pen traces them the moment
// she starts saying it. Drawings written after the last sentence go with it
// (or right away if she is already saying it).
let heldMarks = [];

function resetAnswer() {
  lastSay = null;
  heldMarks = [];
  textBox.innerHTML = '';
  textBox.classList.remove('error');
  steps.replaceChildren();
}

// A card for what Claude made (opened in the browser) or a site it mentions.
// The same link again only updates its title.
const LINK_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2h5v5M14 2L7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5"/></svg>';
function showLink({ title, url }) {
  let card = [...links.children].find((c) => c.dataset.url === url);
  if (!card) {
    card = Object.assign(document.createElement('button'), { type: 'button', className: 'link', title: url });
    card.dataset.url = url;
    card.innerHTML = `${LINK_ICON}<span></span>`;
    card.addEventListener('click', () => api.openLink(url));
    links.append(card);
  }
  card.querySelector('span').textContent = title;
}

function addStep(text) {
  for (const li of steps.children) li.classList.remove('current');
  steps.append(Object.assign(document.createElement('li'), { textContent: text, title: text, className: 'current' }));
}

function run(command) {
  if (command.type === 'step') return addStep(command.text);
  api.show(command);
}

// The answer is over: drawings still held go with the last sentence.
function releaseHeld() {
  const rest = heldMarks;
  heldMarks = [];
  if (lastSay && !lastSay.started) lastSay.marks.push(...rest);
  else rest.forEach(run);
}

// ----- the components, driven by the conversation manager -----
const ears = createEars({
  transcribe: (audio) => api.transcribe(audio),
  // Her echo: what she said last, and while she speaks, what she is saying now.
  filter: (text, info) => api.filterHeard(text, info.followUp || info.bargeIn ? [lastSpoken, ...spokenNow].join(' ') : ''),
  onLevel: (level) => bars.style.setProperty('--level', Math.min(1, level * 12).toFixed(2)),
  onPartial: (text) => {
    question.value = text;
    question.scrollLeft = question.scrollWidth;
  },
});

let lastSpoken = ''; // what Judith just said: if the mic hears it, it is her echo
const spokenNow = [];

const conversation = createConversation({
  listen: (info) => {
    // Guided agent mode: between steps the screen moves her on. Unless she
    // asked a question, she rests and only watches for the user's voice:
    // real words (not music, not her echo) and she listens to them.
    if (info.followUp && notch.classList.contains('agent') && !/\?\s*$/.test(spokenNow.at(-1) ?? '')) {
      conversation.heard('', info);
      setTimeout(watchBetweenSteps, 0);
      return;
    }
    resetAnswer();
    ears.start(info, (text) => conversation.heard(text, info), () => api.timing('heard')).catch((error) => {
      conversation.cancel();
      showState('idle', { error: t('Micro indisponible : {error}. Écris ta question.', { error: error.message }) });
    });
  },
  finishListening: () => ears.finish(),
  stopListening: () => ears.cancel(),
  ask: (text, turn) => {
    offer.hidden = true;
    resetAnswer();
    links.replaceChildren();
    spokenNow.length = 0;
    api.ask(text, turn);
  },
  cancelAsk: (turn) => api.cancel(turn),
  stopVoice: () => voice.stop(),
  voiceBusy: () => voice.speaking,
  watchForInterruptions: (on) => ears.watch(on, () => conversation.interrupt()),
  clearScreen: () => api.clearScreen(),
  ui: showState,
  later: (fn, ms) => {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  },
});

voice.onIdle(() => {
  lastSpoken = spokenNow.join(' ');
  notch.classList.remove('talking');
  conversation.voiceIdle();
});

// ----- what Claude Code sends, tagged with the turn it belongs to -----
api.on('cmd', ({ turn, ...command }) => {
  if (turn !== conversation.turn) return; // a cancelled turn
  if (command.type === 'say') {
    const item = { started: false, marks: heldMarks };
    heldMarks = [];
    lastSay = item;
    voice.say(command.text, () => {
      if (!conversation.sentence(turn)) return;
      api.timing('voice');
      item.started = true;
      item.marks.splice(0).forEach(run);
      spokenNow.push(command.text);
      notch.classList.add('talking');
      textBox.classList.remove('error');
      textBox.innerHTML = render(command.text);
    });
    return;
  }
  // Steps show at once; drawings wait for their sentence.
  if (command.type === 'step') return run(command);
  heldMarks.push(command);
});

api.on('link', ({ turn, ...link }) => {
  if (turn === conversation.turn) showLink(link);
});
// The zones shown: the notch keeps a numbered thumbnail of each, and the zone
// button draws one more.
const zonesBox = document.getElementById('zones');
api.on('zones', (list) => {
  const zones = Array.isArray(list) ? list : [];
  zoneButton.setAttribute('aria-pressed', String(zones.length > 0));
  zoneButton.title = zones.length ? t('Ajouter une autre zone (Ctrl+Alt+Maj+J)') : t('Choisir la zone à expliquer (Ctrl+Alt+Maj+J)');
  zonesBox.hidden = zones.length === 0;
  const known = new Map([...zonesBox.children].map((node) => [node.dataset.key, node]));
  zonesBox.replaceChildren(
    ...zones.map((zone, i) => {
      // A thumbnail that is already there stays (no flicker while the next one arrives).
      const key = `${i}:${zone.thumb ? 'img' : 'wait'}`;
      const old = known.get(key);
      if (old && zone.thumb && old.dataset.thumb === zone.thumb) return old;
      const node = document.createElement('div');
      node.className = 'zthumb';
      node.dataset.key = key;
      node.dataset.thumb = zone.thumb;
      if (zone.thumb) node.style.backgroundImage = `url("${zone.thumb}")`;
      node.setAttribute('role', 'img');
      node.setAttribute('aria-label', `Zone ${zone.n}`);
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = String(zone.n);
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'x';
      x.setAttribute('aria-label', t('Retirer la zone {n}', { n: zone.n }));
      x.innerHTML = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1L9 9M9 1L1 9"/></svg>';
      x.addEventListener('click', () => api.removeZone(i));
      node.append(n, x);
      return node;
    }),
  );
});
api.on('notice', (text) => toast(text, { warn: true }));
api.on('answer', ({ turn }) => {
  if (turn === conversation.turn) releaseHeld();
  conversation.answered(turn);
});
api.on('error', ({ turn, message }) => conversation.failed(turn, message));
api.on('tool', ({ turn, label: text }) => {
  if (turn === conversation.turn && conversation.state === 'thinking') doing.textContent = `${text}…`;
});
api.on('stale', () => {
  if (conversation.state !== 'speaking') return;
  textBox.innerHTML = t("L'écran a bougé depuis que j'ai regardé : redemande-moi et je regarde à nouveau.");
});

// ----- summon, type, stop, cancel -----
api.on('focus', ({ conversation: keepTalking, interruptions, stt, push } = {}) => {
  ears.configure(stt);
  ears.setPush(push);
  conversation.configure({ conversation: keepTalking, interruptions });
  conversation.summon();
});
api.on('idle', () => conversation.cancel());
// The summon shortcut pressed again while Judith thinks or speaks.
api.on('cancel-all', () => {
  api.log('shortcut: cancel');
  conversation.cancel();
});
// A question sent by the app itself (demo mode).
api.on('ask', (text) => conversation.typed(text));

// ----- agent mode: the notch shows the step; the next one starts by itself -----
const idleName = document.querySelector('.idle-name');
api.on('agent', ({ active, step, max, done, timeout, limit }) => {
  notch.classList.toggle('agent', Boolean(active));
  idleName.textContent = active ? t('Étape {step}/{max}', { step, max }) : 'Judith';
  if (active) return;
  const message = done ? t('Objectif atteint ✓') : timeout ? t('Je m’arrête là. Rappelle-moi si tu veux continuer.') : limit ? t('On a fait beaucoup d’étapes : je m’arrête là.') : '';
  if (message && conversation.state !== 'thinking' && conversation.state !== 'speaking') showState('idle', { message });
});
function watchBetweenSteps() {
  if (!notch.classList.contains('agent') || conversation.state !== 'idle') return;
  ears.watch(true, (text) => {
    ears.watch(false);
    conversation.overheard(text);
  });
}

// A soft two-note "got it" the moment Judith sees the user did the step: the
// next one takes a few seconds to come, the user knows she is on it.
function gotIt() {
  try {
    const ctx = new AudioContext();
    [660, 880].forEach((freq, i) => {
      const tone = ctx.createOscillator();
      const gain = ctx.createGain();
      const at = ctx.currentTime + i * 0.09;
      tone.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.08, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      tone.connect(gain).connect(ctx.destination);
      tone.start(at);
      tone.stop(at + 0.18);
    });
    setTimeout(() => ctx.close(), 600);
  } catch {}
}
api.on('agent-next', ({ question: next, step, max }) => {
  gotIt();
  idleName.textContent = t('Étape {step}/{max}', { step, max });
  conversation.continueWith(next, t('Étape {step}/{max} : je regarde ce que tu as fait', { step, max }));
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  conversation.typed(question.value);
});
question.addEventListener('input', (event) => {
  // The user types: stop listening (only real typing fires this event).
  if (!event.isTrusted) return;
  typedByHand = true;
  if (conversation.state === 'listening') ears.cancel();
});

// Stop and X act on the press itself, not on the release: a click needs the
// press and the release on the same element, and the notch changes under the
// pointer (text arriving, state changing). Keyboard activation (Enter, Space)
// still goes through 'click', whose detail is 0 for keys.
function onPress(button, action) {
  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    api.log(`${button.id} pressed (${conversation.state})`);
    action();
  });
  button.addEventListener('click', (event) => {
    if (event.detail === 0) action();
  });
}
// Send: "I am done". What was typed goes as it is; otherwise what was said so
// far is transcribed and asked (the same as pressing the shortcut again).
onPress(document.getElementById('send'), () => {
  if (typedByHand && question.value.trim()) conversation.typed(question.value);
  else conversation.summon();
});
// X: the conversation is over, Judith goes back to rest.
onPress(document.getElementById('close'), () => conversation.cancel());
zoneButton.addEventListener('click', () => api.pickZone());
// At rest, the whole pill summons Judith; its zone button summons her with a
// zone, its gear opens the settings.
notch.addEventListener('click', (event) => {
  if (notch.dataset.state !== 'none') return;
  if (event.target.closest('#idle-settings')) openSettings();
  else if (event.target.closest('#idle-zone')) api.summonZone();
  else api.summon();
});

// ----- settings: Claude Code's model and effort, drawing, listening -----
const settingsStatus = document.getElementById('settings-status');
const claudeChip = document.getElementById('claude-chip');
const claudeMissing = document.getElementById('claude-missing');
const modelBox = document.getElementById('claude-model');
const modelHint = document.getElementById('model-hint');
const drawHint = document.getElementById('draw-hint');
const pushTalk = document.getElementById('push-talk');
const boardOn = document.getElementById('board-on');
const agentHands = document.getElementById('agent-hands');
const claudeActs = document.getElementById('claude-acts');

// A segmented control: one choice among a few, as radio buttons in a row
// (click, or the arrow keys once it has the focus).
function segmented(root, onChange = () => {}) {
  const buttons = () => [...root.querySelectorAll('button[data-value]')];
  const control = {
    get value() {
      return root.dataset.value ?? '';
    },
    set value(next) {
      root.dataset.value = next;
      for (const button of buttons()) {
        const on = button.dataset.value === next;
        button.setAttribute('aria-checked', String(on));
        button.tabIndex = on ? 0 : -1;
      }
      onChange(next);
    },
  };
  root.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-value]');
    if (button) control.value = button.dataset.value;
  });
  root.addEventListener('keydown', (event) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const all = buttons();
    const next = all[(all.findIndex((b) => b.dataset.value === control.value) + step + all.length) % all.length];
    control.value = next.dataset.value;
    next.focus();
  });
  return control;
}

// Each choice says what it changes for the user, under the name of the setting.
const MODEL_HINTS = {
  haiku: t('Rapide : le bon choix pour discuter.'),
  sonnet: t('Équilibré : plus précis, un peu plus lent.'),
  opus: t('Le plus fin : il annote mieux, et répond plus lentement.'),
};
const DRAW_HINTS = {
  helpful: t("Seulement quand ça t'évite de chercher."),
  always: t("Dès qu'elle regarde ton écran."),
  none: t('Jamais : elle décrit avec des mots.'),
};
const claudeModel = segmented(modelBox, (value) => (modelHint.textContent = MODEL_HINTS[value] ?? t('Modèle choisi dans config.json.')));
const claudeEffort = segmented(document.getElementById('claude-effort'));
const drawMode = segmented(document.getElementById('annotations'), (value) => (drawHint.textContent = DRAW_HINTS[value] ?? ''));

// A full model id written in config.json (claude-opus-5-5…) gets its own choice.
function showModel(model) {
  modelBox.querySelector('[data-custom]')?.remove();
  if (model && !MODEL_HINTS[model]) {
    const button = Object.assign(document.createElement('button'), { type: 'button', textContent: model });
    button.setAttribute('role', 'radio');
    button.dataset.value = model;
    button.dataset.custom = '';
    modelBox.append(button);
  }
  claudeModel.value = model || 'haiku';
}

function setStatus(text, kind = '') {
  settingsStatus.textContent = text;
  settingsStatus.className = `settings-status ${kind}`;
}

function renderSettings(data) {
  claudeChip.dataset.state = data.claudeFound ? 'ok' : 'missing';
  claudeChip.textContent = data.claudeFound ? t('Claude Code détecté') : t('Claude Code introuvable');
  claudeMissing.hidden = Boolean(data.claudeFound);
  showModel(data.model);
  claudeEffort.value = data.effort ?? 'low';
  drawMode.value = data.annotations ?? 'helpful';
  pushTalk.checked = data.listenMode === 'push';
  boardOn.checked = Boolean(data.board);
  agentHands.checked = Boolean(data.agentHands);
  claudeActs.checked = Boolean(data.claudeActs);
  agentHands.disabled = !data.handsAvailable;
  document.getElementById('hands-note').textContent = data.handsAvailable ? '' : t('Indisponible : le compagnon judith-hands.exe n’est pas installé (Windows seulement).');
}

function formSettings() {
  return {
    model: claudeModel.value,
    effort: claudeEffort.value,
    annotations: drawMode.value,
    listenMode: pushTalk.checked ? 'push' : 'auto',
    board: boardOn.checked,
    agentHands: agentHands.checked,
    claudeActs: claudeActs.checked,
  };
}

async function openSettings() {
  conversation.cancel();
  notch.dataset.state = 'settings';
  api.notchState('settings');
  setStatus('');
  renderSettings(await api.settings.get());
}
function closeSettings() {
  if (notch.dataset.state === 'settings') showState('idle');
}

document.getElementById('claude-install').addEventListener('click', () => api.openLink('https://docs.claude.com/en/docs/claude-code/setup'));
// The language of Judith (screen, voice, listening): changing it reloads the windows.
for (const button of document.querySelectorAll('.lang button')) {
  button.setAttribute('aria-pressed', String(button.dataset.lang === api.language));
  button.addEventListener('click', () => button.dataset.lang !== api.language && api.setLanguage(button.dataset.lang));
}
document.getElementById('settings').addEventListener('click', openSettings);
document.getElementById('settings-close').addEventListener('click', closeSettings);
document.getElementById('settings-test').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  setStatus(t('Je teste : une question et une petite image…'));
  const result = await api.settings.test(formSettings()).catch((error) => ({ ok: false, error: error.message }));
  button.disabled = false;
  if (result.ok) setStatus(t('Ça marche : réponse en {value} s.', { value: (result.ms / 1000).toFixed(1) }), 'ok');
  else setStatus(result.error, 'error');
});
// A short confirmation under the notch.
const toastBox = document.getElementById('toast');
let toastTimer = null;
function toast(text, { warn = false } = {}) {
  clearTimeout(toastTimer);
  toastBox.textContent = warn ? text : `✓ ${text}`;
  toastBox.classList.toggle('warn', warn);
  toastBox.hidden = false;
  // Under the notch, which may still be changing shape (settings → rest).
  const place = () => (toastBox.style.top = `${Math.round(notch.getBoundingClientRect().bottom) + 12}px`);
  place();
  setTimeout(place, 480);
  requestAnimationFrame(() => toastBox.classList.add('on'));
  toastTimer = setTimeout(() => {
    toastBox.classList.remove('on');
    setTimeout(() => (toastBox.hidden = true), 300);
  }, 2600);
}
// Saved: the panel closes and the notch goes back to rest, where it was opened from.
document.getElementById('settings-save').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  const result = await api.settings.save(formSettings()).catch((error) => ({ ok: false, error: error.message }));
  button.disabled = false;
  if (!result.ok) return setStatus(result.error, 'error');
  closeSettings();
  toast(t('Enregistré'));
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && notch.dataset.state === 'settings') return closeSettings();
  if (event.key === 'Escape') conversation.cancel();
});
pauseButton.addEventListener('click', () => {
  voice.setPaused(!voice.paused);
  pauseButton.setAttribute('aria-pressed', String(voice.paused));
  pauseButton.setAttribute('aria-label', voice.paused ? t('Reprendre') : t('Pause'));
  pauseButton.title = voice.paused ? t('Reprendre') : t('Pause');
  notch.classList.toggle('talking', !voice.paused);
});

// The window is a fixed transparent stage: it takes the clicks only while the
// pointer is over the notch, and lets them through everywhere else.
notch.addEventListener('pointerenter', () => api.interactive(true));
notch.addEventListener('pointerleave', () => api.interactive(false));
showState('idle');

// ----- autonomous agent mode: "Vas-y / Non" -----
const confirmBox = document.getElementById('confirm');
let stateBeforeConfirm = null;
api.on('confirm', (request) => {
  if (!request) {
    if (notch.dataset.state === 'confirm') notch.dataset.state = stateBeforeConfirm ?? 'none';
    api.notchState(notch.dataset.state);
    return;
  }
  stateBeforeConfirm = notch.dataset.state === 'confirm' ? stateBeforeConfirm : notch.dataset.state;
  document.getElementById('confirm-text').textContent = request.reason;
  notch.dataset.state = 'confirm';
  api.notchState('confirm');
});
// "Vas-y" with a real pointer press only: a stray Enter or Space on a focused
// button must never approve an action. "Non" works any way.
document.getElementById('confirm-yes').addEventListener('pointerdown', (event) => {
  if (event.button === 0 && event.isTrusted) api.confirmAnswer(true);
});
onPress(document.getElementById('confirm-no'), () => api.confirmAnswer(false));
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && notch.dataset.state === 'confirm') api.confirmAnswer(false);
});

// Where the notch really is in its window: the rest shows the user's apps,
// where Judith may look and (in autonomous mode) click.
new ResizeObserver(() => {
  const r = notch.getBoundingClientRect();
  api.notchBox({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
}).observe(notch);

// ----- the offer to guide a task in several steps to the end -----
const offer = document.getElementById('offer');
api.on('offer', () => {
  offer.hidden = false;
});
// The same as saying it: the answer goes through the conversation.
onPress(document.getElementById('offer-yes'), () => conversation.typed('oui'));
onPress(document.getElementById('offer-no'), () => conversation.typed('non'));
