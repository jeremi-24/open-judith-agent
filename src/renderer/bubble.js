// The notch. It shows the conversation and forwards events to the
// conversation manager, which alone decides what happens next.
import { createConversation } from '../core/conversation.js';
import { createEars } from './ears.js';

const notch = document.querySelector('.notch');
const label = document.getElementById('label');
const doing = document.getElementById('doing');
const textBox = document.getElementById('text');
const steps = document.getElementById('steps');
const form = document.getElementById('form');
const question = document.getElementById('question');
const bars = document.querySelector('.bars');
const pauseButton = document.getElementById('pause');
const approval = document.getElementById('approval');
const voice = window.JudithVoice;
const api = window.judith;

// ----- display -----
const LABELS = { listening: "J'écoute…", thinking: 'Je réfléchis…', speaking: 'Judith parle' };
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
function showState(state, info = {}) {
  clearTimeout(messageTimer);
  // A message or an error is shown a few seconds, then the notch rests.
  const message = info.error ?? info.message;
  const shown = state === 'idle' && message ? 'speaking' : state;
  notch.dataset.state = shown === 'idle' ? 'none' : shown;
  notch.dataset.mood = MOODS[state] ?? 'listen';
  if (LABELS[shown]) label.textContent = LABELS[shown];
  notch.classList.toggle('talking', shown === 'speaking' && !message && !info.done && voice.speaking);

  if (state === 'listening') {
    question.value = info.partial ?? '';
    question.placeholder = info.followUp ? 'Autre chose ? Je t’écoute…' : info.continuation ? 'Je t’écoute, continue…' : 'Parle, ou écris ta question…';
    question.focus();
  }
  if (state === 'thinking') doing.textContent = info.heard ? `« ${info.heard} »` : 'Je réfléchis…';
  if (message) {
    textBox.innerHTML = render(message);
    textBox.classList.toggle('error', Boolean(info.error));
    messageTimer = setTimeout(() => notch.dataset.state === 'speaking' && conversation.state === 'idle' && showState('idle'), 4000);
  }
  if (state === 'idle' && !message) ears.close();
}

// ----- the answer: spoken sentences, steps and drawings -----
let lastSay = null; // the last sentence queued, until it starts

function resetAnswer() {
  lastSay = null;
  textBox.innerHTML = '';
  textBox.classList.remove('error');
  steps.replaceChildren();
}

function addStep(text) {
  for (const li of steps.children) li.classList.remove('current');
  steps.append(Object.assign(document.createElement('li'), { textContent: text, title: text, className: 'current' }));
}

function run(command) {
  if (command.type === 'step') addStep(command.text);
  else api.show(command);
}

// ----- the components, driven by the conversation manager -----
const ears = createEars({
  transcribe: (audio) => api.transcribe(audio),
  filter: (text, info) => api.filterHeard(text, info.followUp || info.bargeIn ? lastSpoken : ''),
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
    resetAnswer();
    ears.start(info, (text) => conversation.heard(text, info)).catch((error) => {
      conversation.cancel();
      showState('idle', { error: `Micro indisponible : ${error.message}. Écris ta question.` });
    });
  },
  finishListening: () => ears.finish(),
  stopListening: () => ears.cancel(),
  ask: (text, turn) => {
    resetAnswer();
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
    const item = { actions: [], started: false };
    lastSay = item;
    voice.say(command.text, () => {
      if (!conversation.sentence(turn)) return;
      item.started = true;
      spokenNow.push(command.text);
      notch.classList.add('talking');
      textBox.classList.remove('error');
      textBox.innerHTML = render(command.text);
      item.actions.forEach(run);
    });
    return;
  }
  // Drawings wait for the sentence just before them.
  if (lastSay && !lastSay.started && voice.enabled) lastSay.actions.push(command);
  else run(command);
});

api.on('answer', ({ turn }) => conversation.answered(turn));
api.on('error', ({ turn, message }) => conversation.failed(turn, message));
api.on('tool', ({ turn, label: text }) => {
  if (turn === conversation.turn && conversation.state === 'thinking') doing.textContent = `${text}…`;
});
api.on('stale', () => {
  if (conversation.state !== 'speaking') return;
  textBox.innerHTML = "L'écran a bougé depuis que j'ai regardé : redemande-moi et je regarde à nouveau.";
});

// ----- summon, type, stop, cancel -----
api.on('focus', ({ conversation: keepTalking, interruptions, stt } = {}) => {
  ears.configure(stt);
  conversation.configure({ conversation: keepTalking, interruptions });
  conversation.summon();
});
api.on('idle', () => conversation.cancel());
// A question sent by the app itself (demo mode).
api.on('ask', (text) => conversation.typed(text));

form.addEventListener('submit', (event) => {
  event.preventDefault();
  conversation.typed(question.value);
});
question.addEventListener('input', (event) => {
  // The user types: stop listening (only real typing fires this event).
  if (event.isTrusted && conversation.state === 'listening') ears.cancel();
});

document.getElementById('stop').addEventListener('click', () => ears.finish());
document.getElementById('close').addEventListener('click', () => conversation.cancel());
document.getElementById('summon').addEventListener('click', () => api.summon());
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') conversation.cancel();
});
pauseButton.addEventListener('click', () => {
  voice.setPaused(!voice.paused);
  pauseButton.setAttribute('aria-pressed', String(voice.paused));
  pauseButton.setAttribute('aria-label', voice.paused ? 'Reprendre' : 'Pause');
  notch.classList.toggle('talking', !voice.paused);
});

// ----- approvals -----
let approvalId = null;
function answerApproval(allow) {
  if (approvalId === null) return;
  api.approve(approvalId, allow);
  approvalId = null;
  approval.hidden = true;
}
document.getElementById('allow').addEventListener('click', () => answerApproval(true));
document.getElementById('deny').addEventListener('click', () => answerApproval(false));
api.on('approval', ({ id, title, detail }) => {
  approvalId = id;
  document.getElementById('approval-title').textContent = `${title} ?`;
  document.getElementById('approval-detail').textContent = detail;
  approval.hidden = false;
  document.getElementById('allow').focus();
});
api.on('approved', ({ id }) => {
  if (id === approvalId) {
    approvalId = null;
    approval.hidden = true;
  }
});

// The window hugs the notch: transparent pixels around it would catch clicks.
new ResizeObserver(() => {
  api.resize({ width: notch.offsetWidth + 40, height: notch.offsetHeight + 22 });
}).observe(notch);
showState('idle');
