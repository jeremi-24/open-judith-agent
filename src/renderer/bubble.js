const card = document.querySelector('.card');
const status = document.getElementById('status');
const answer = document.getElementById('answer');
const steps = document.getElementById('steps');
const form = document.getElementById('form');
const question = document.getElementById('question');
const send = form.querySelector('.send');

const STATUS = { idle: "Je t'écoute", thinking: 'Je réfléchis…', speaking: 'Judith parle' };

function setState(state) {
  card.dataset.state = state;
  status.textContent = STATUS[state];
  send.disabled = state === 'thinking';
}

// Tiny, safe markdown: escape everything, then **bold**, `code` and paragraphs.
function render(text) {
  const escaped = text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function showAnswer(text, isError = false) {
  answer.hidden = !text;
  answer.classList.toggle('error', isError);
  answer.innerHTML = render(text);
}

function showSteps(list) {
  steps.hidden = list.length === 0;
  steps.replaceChildren(...list.map((s) => Object.assign(document.createElement('li'), { textContent: s })));
}

function autosize() {
  question.style.height = 'auto';
  question.style.height = `${question.scrollHeight}px`;
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = question.value.trim();
  if (!text || card.dataset.state === 'thinking') return;
  question.value = '';
  autosize();
  showAnswer('');
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
  if (event.key === 'Escape') window.judith.close();
});
document.getElementById('close').addEventListener('click', () => window.judith.close());

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
  showAnswer(text);
});
window.judith.on('answer', ({ text, steps: list }) => {
  setState('speaking');
  showAnswer(text);
  showSteps(list);
  question.focus();
});
window.judith.on('error', (message) => {
  setState('idle');
  showAnswer(message, true);
});
window.judith.on('mode', (mode) => {
  for (const button of document.querySelectorAll('.mode button')) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  }
});

// The window follows the card's height.
new ResizeObserver(() => window.judith.resize(card.offsetHeight + 28)).observe(card);
