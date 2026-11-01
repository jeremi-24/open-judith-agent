const notch = document.querySelector('.notch');
const status = document.getElementById('status');
const caption = document.getElementById('caption');
const steps = document.getElementById('steps');
const form = document.getElementById('form');
const question = document.getElementById('question');
const send = form.querySelector('.send');
const voiceButton = document.getElementById('voice');
const voice = window.JudithVoice;

const STATUS = { idle: 'Judith', listening: "Je t'écoute…", transcribing: "J'ai entendu…", thinking: 'Je réfléchis…', speaking: 'Judith parle' };
const recorder = window.JudithRecorder;
const mic = document.getElementById('mic');
let answerText = '';

function setState(state) {
  notch.dataset.state = state;
  status.textContent = STATUS[state];
  send.disabled = state === 'thinking';
}

// Tiny, safe markdown: escape everything, then **bold** and `code`.
function render(text) {
  return text
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n+/g, ' ');
}

function showCaption(text, { error = false, full = false } = {}) {
  caption.hidden = !text;
  caption.classList.toggle('error', error);
  caption.classList.toggle('full', full);
  caption.innerHTML = render(text);
}

function showSteps(list) {
  steps.hidden = list.length === 0;
  steps.replaceChildren(...list.map((s) => Object.assign(document.createElement('li'), { textContent: s, title: s })));
}

function autosize() {
  question.style.height = 'auto';
  question.style.height = `${question.scrollHeight}px`;
}

// With the voice on, the caption follows the sentence being spoken, so the
// notch stays small. With the voice off, it shows the whole answer.
voice.on({
  sentence: (sentence) => {
    notch.classList.add('talking');
    showCaption(sentence);
  },
  idle: () => notch.classList.remove('talking'),
});

function setVoice(on) {
  voice.setEnabled(on);
  voiceButton.setAttribute('aria-pressed', String(on));
  voiceButton.setAttribute('aria-label', on ? 'Couper la voix' : 'Activer la voix');
  if (!on) {
    notch.classList.remove('talking');
    if (answerText) showCaption(answerText, { full: true });
  }
  try {
    localStorage.setItem('judith.voice', on ? 'on' : 'off');
  } catch {}
}

function askJudith(text) {
  if (!text || notch.dataset.state === 'thinking') return;
  voice.stop();
  answerText = '';
  showCaption('');
  showSteps([]);
  window.judith.ask(text);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = question.value.trim();
  question.value = '';
  autosize();
  askJudith(text);
});

// Voice: listen, stop after a short silence, transcribe with Whisper, ask.
async function listen() {
  if (recorder.listening) return;
  voice.stop();
  notch.classList.remove('talking');
  try {
    await recorder.start({
      onLevel: (level) => mic.style.setProperty('--level', level.toFixed(2)),
      onEnd: heard,
    });
  } catch (error) {
    showCaption(`Je n'ai pas accès au micro : ${error.message}`, { error: true, full: true });
    return;
  }
  mic.setAttribute('aria-pressed', 'true');
  setState('listening');
}

function stopListening() {
  mic.setAttribute('aria-pressed', 'false');
  mic.style.setProperty('--level', '0');
}

async function heard(audio) {
  stopListening();
  if (!audio) {
    setState('idle');
    showCaption("Je n'ai rien entendu. Parle-moi ou écris ta question.", { full: true });
    return;
  }
  setState('transcribing');
  try {
    const text = await window.judith.transcribe(audio);
    if (!text) {
      setState('idle');
      showCaption("Je n'ai pas compris, tu peux répéter ?", { full: true });
      return;
    }
    showCaption(`« ${text} »`, { full: true });
    askJudith(text);
  } catch (error) {
    setState('idle');
    showCaption(error.message, { error: true, full: true });
  }
}

mic.addEventListener('click', () => (recorder.listening ? recorder.finish() : listen()));

question.addEventListener('input', () => {
  autosize();
  // Typing means the user prefers to write: stop listening.
  if (recorder.listening && question.value) {
    recorder.cancel();
    stopListening();
    setState('idle');
  }
});
question.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});
function close() {
  voice.stop();
  recorder.cancel();
  stopListening();
  window.judith.close();
}
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') close();
});
document.getElementById('close').addEventListener('click', close);
voiceButton.addEventListener('click', () => setVoice(!voice.enabled));
caption.addEventListener('click', () => answerText && showCaption(answerText, { full: true }));

// Approval card: Judith wants to edit a file or run a command.
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
  if (voice.enabled) voice.feed(`${title} ?`, true);
  document.getElementById('allow').focus();
});
window.judith.on('approved', ({ id }) => {
  if (id === approvalId) {
    approvalId = null;
    approval.hidden = true;
  }
});

// While Judith uses a tool, the status says what she is doing.
window.judith.on('tool', (label) => {
  setState('thinking');
  status.textContent = `${label}…`;
});

// Summoned (shortcut): listen right away. Summoned again while listening:
// the user is done talking.
window.judith.on('focus', ({ listen: shouldListen } = {}) => {
  question.focus();
  if (recorder.listening) return recorder.finish();
  if (notch.dataset.state === 'thinking' || notch.dataset.state === 'transcribing') return;
  setState('idle');
  if (shouldListen) listen();
});
window.judith.on('state', setState);
window.judith.on('delta', (text) => {
  setState('speaking');
  answerText = text;
  if (voice.enabled) voice.feed(text);
  else showCaption(text, { full: true });
});
window.judith.on('answer', ({ text, steps: list }) => {
  setState('speaking');
  answerText = text;
  if (voice.enabled) voice.feed(text, true);
  else showCaption(text, { full: true });
  showSteps(list);
  question.focus();
});
window.judith.on('error', (message) => {
  setState('idle');
  showCaption(message, { error: true, full: true });
});

try {
  if (localStorage.getItem('judith.voice') === 'off') setVoice(false);
} catch {}

// The window hugs the notch (plus its shoulders and shadow): transparent
// pixels around it would still catch the user's clicks.
new ResizeObserver(() => {
  window.judith.resize({ width: notch.offsetWidth + 28, height: notch.offsetHeight + 12 });
}).observe(notch);
