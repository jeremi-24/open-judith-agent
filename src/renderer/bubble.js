const notch = document.querySelector('.notch');
const status = document.getElementById('status');
const caption = document.getElementById('caption');
const steps = document.getElementById('steps');
const form = document.getElementById('form');
const question = document.getElementById('question');
const send = form.querySelector('.send');
const voiceButton = document.getElementById('voice');
const voice = window.JudithVoice;

const STATUS = { idle: "Je t'écoute", thinking: 'Je réfléchis…', speaking: 'Judith parle' };
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

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = question.value.trim();
  if (!text || notch.dataset.state === 'thinking') return;
  question.value = '';
  autosize();
  voice.stop();
  answerText = '';
  showCaption('');
  showSteps([]);
  window.judith.ask(text);
});

question.addEventListener('input', autosize);
question.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    voice.stop();
    window.judith.close();
  }
});
document.getElementById('close').addEventListener('click', () => {
  voice.stop();
  window.judith.close();
});
voiceButton.addEventListener('click', () => setVoice(!voice.enabled));
caption.addEventListener('click', () => answerText && showCaption(answerText, { full: true }));

for (const button of document.querySelectorAll('.mode button')) {
  button.addEventListener('click', () => window.judith.setMode(button.dataset.mode));
}

window.judith.on('focus', () => {
  setState('idle');
  question.focus();
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
window.judith.on('mode', (mode) => {
  for (const button of document.querySelectorAll('.mode button')) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  }
});

try {
  if (localStorage.getItem('judith.voice') === 'off') setVoice(false);
} catch {}

// The window hugs the notch (plus its shoulders and shadow): transparent
// pixels around it would still catch the user's clicks.
new ResizeObserver(() => {
  window.judith.resize({ width: notch.offsetWidth + 28, height: notch.offsetHeight + 12 });
}).observe(notch);
