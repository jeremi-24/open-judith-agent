// The notch: listens, thinks, speaks, and plays Judith's script so that each
// drawing appears when the sentence before it starts.
const notch = document.querySelector('.notch');
const label = document.getElementById('label');
const doing = document.getElementById('doing');
const textBox = document.getElementById('text');
const steps = document.getElementById('steps');
const form = document.getElementById('form');
const question = document.getElementById('question');
const pauseButton = document.getElementById('pause');
const voice = window.JudithVoice;
const recorder = window.JudithRecorder;

const LABELS = { listening: "J'écoute…", thinking: 'Je réfléchis…', speaking: 'Judith parle' };
const MOODS = { none: 'listen', listening: 'listen', thinking: 'think', speaking: 'explain' };

function setState(state) {
  notch.dataset.state = state;
  notch.dataset.mood = MOODS[state] ?? 'listen';
  if (LABELS[state]) label.textContent = LABELS[state];
}

// Tiny, safe markdown: escape everything, then **bold** and `code`.
function render(text) {
  return text
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

// ----- the answer: spoken sentences, steps and drawings -----
let spoken = [];
let lastSay = null; // the last sentence queued, until it starts

function resetAnswer() {
  voice.stop();
  spoken = [];
  lastSay = null;
  textBox.innerHTML = '';
  textBox.classList.remove('error');
  steps.replaceChildren();
  notch.classList.remove('talking');
}

function showSentence(text) {
  setState('speaking');
  notch.classList.add('talking');
  textBox.classList.remove('error');
  spoken.push(text);
  textBox.innerHTML = render(text);
}

function addStep(text) {
  for (const li of steps.children) li.classList.remove('current');
  const li = Object.assign(document.createElement('li'), { textContent: text, title: text, className: 'current' });
  steps.append(li);
  li.scrollIntoView({ inline: 'nearest' });
}

function run(command) {
  if (command.type === 'step') addStep(command.text);
  else window.judith.show(command);
}

window.judith.on('cmd', (command) => {
  if (command.type === 'say') {
    const item = { actions: [], started: false };
    lastSay = item;
    voice.say(command.text, () => {
      item.started = true;
      showSentence(command.text);
      item.actions.forEach(run);
    });
    return;
  }
  // Drawings wait for the sentence just before them.
  if (lastSay && !lastSay.started && voice.enabled) lastSay.actions.push(command);
  else run(command);
});

voice.onIdle(() => notch.classList.remove('talking'));

window.judith.on('answer', () => {
  if (!spoken.length && !lastSay) setState('none');
  question.value = '';
});

window.judith.on('error', (message) => {
  setState('speaking');
  textBox.innerHTML = render(message);
  textBox.classList.add('error');
});

window.judith.on('tool', (text) => {
  if (notch.dataset.state === 'speaking' && voice.speaking) return;
  setState('thinking');
  doing.textContent = `${text}…`;
});

// ----- asking -----
function askJudith(text) {
  if (!text) return;
  resetAnswer();
  setState('thinking');
  doing.textContent = 'Je regarde ton écran';
  window.judith.ask(text);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = question.value.trim();
  recorder.cancel();
  askJudith(text);
});

question.addEventListener('input', () => {
  // Typing means the user prefers to write: stop listening.
  if (recorder.listening && question.value) recorder.cancel();
});

// ----- listening -----
const bars = document.querySelector('.bars');
async function listen() {
  if (recorder.listening) return;
  resetAnswer();
  setState('listening');
  question.value = '';
  question.focus();
  try {
    await recorder.start({
      onLevel: (level) => bars.style.setProperty('--level', level.toFixed(2)),
      onEnd: heard,
    });
  } catch (error) {
    question.placeholder = `Micro indisponible : ${error.message}. Écris ta question.`;
  }
}

async function heard(audio) {
  bars.style.setProperty('--level', '0');
  if (!audio) {
    question.placeholder = "Je n'ai rien entendu. Parle, ou écris ta question…";
    return;
  }
  setState('thinking');
  doing.textContent = "J'écoute ce que tu as dit";
  try {
    const text = await window.judith.transcribe(audio);
    if (!text) {
      setState('listening');
      question.placeholder = "Je n'ai pas compris, tu peux répéter ?";
      return;
    }
    question.value = text;
    askJudith(text);
  } catch (error) {
    setState('listening');
    question.placeholder = error.message;
  }
}

document.getElementById('stop').addEventListener('click', () => recorder.finish());

// ----- controls -----
function close() {
  resetAnswer();
  recorder.cancel();
  setState('none');
  window.judith.close();
}
document.getElementById('close').addEventListener('click', close);
document.getElementById('summon').addEventListener('click', () => window.judith.summon());
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') close();
});
pauseButton.addEventListener('click', () => {
  voice.setPaused(!voice.paused);
  pauseButton.setAttribute('aria-pressed', String(voice.paused));
  pauseButton.setAttribute('aria-label', voice.paused ? 'Reprendre' : 'Pause');
  notch.classList.toggle('talking', !voice.paused);
});

// Summoned (shortcut): listen right away. Summoned again while listening:
// the user is done talking.
window.judith.on('focus', ({ listen: shouldListen } = {}) => {
  if (recorder.listening) return recorder.finish();
  if (shouldListen) listen();
  else {
    resetAnswer();
    setState('listening');
    question.focus();
  }
});
window.judith.on('idle', () => setState('none'));
// A question sent by the app itself (demo mode).
window.judith.on('ask', (text) => {
  recorder.cancel();
  question.value = text;
  askJudith(text);
});

// ----- approvals -----
const approval = document.getElementById('approval');
let approvalId = null;
function answerApproval(allow) {
  if (approvalId === null) return;
  window.judith.approve(approvalId, allow);
  approvalId = null;
  approval.hidden = true;
}
document.getElementById('allow').addEventListener('click', () => answerApproval(true));
document.getElementById('deny').addEventListener('click', () => answerApproval(false));
window.judith.on('approval', ({ id, title, detail }) => {
  approvalId = id;
  document.getElementById('approval-title').textContent = `${title} ?`;
  document.getElementById('approval-detail').textContent = detail;
  approval.hidden = false;
  if (notch.dataset.state === 'none') setState('thinking');
  document.getElementById('allow').focus();
});
window.judith.on('approved', ({ id }) => {
  if (id === approvalId) {
    approvalId = null;
    approval.hidden = true;
  }
});

// The window hugs the notch: transparent pixels around it would catch clicks.
new ResizeObserver(() => {
  window.judith.resize({ width: notch.offsetWidth + 40, height: notch.offsetHeight + 22 });
}).observe(notch);
setState('none');
