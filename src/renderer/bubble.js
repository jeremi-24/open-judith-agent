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
// Ears: Deepgram live listening when the user gave a key, local Whisper otherwise.
let stt = null;
const live = () => stt?.provider === 'deepgram' && stt.key;
const ears = () => (live() ? window.JudithLive : recorder);

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
    .replace(/\s*\[[a-z][a-z '-]{0,30}\]\s*/gi, ' ') // emotion tags are for the voice only
    .trim()
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
  textBox.dataset.stale = '';
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
    // Never listen while Judith talks: the mic would hear her.
    ears().cancel();
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

// ----- conversation: when Judith has finished, she listens again -----
let canListen = false; // voice input ready (sent with 'focus')
let conversation = false;
let answerDone = false;

function maybeListenAgain() {
  if (!answerDone || voice.speaking || !approval.hidden) return;
  answerDone = false;
  lastSpoken = spoken.join(' ');
  // A short pause first: the speakers (Bluetooth above all) may still be playing her last word.
  if (conversation && canListen && notch.dataset.state !== 'none') {
    setTimeout(() => notch.dataset.state !== 'none' && !voice.speaking && listen({ followUp: true }), 800);
  }
}

voice.onIdle(() => {
  notch.classList.remove('talking');
  maybeListenAgain();
});

window.judith.on('answer', () => {
  question.value = '';
  answerDone = true;
  if (!spoken.length && !lastSay) {
    if (!conversation || !canListen) setState('none');
  }
  maybeListenAgain();
});

window.judith.on('error', (message) => {
  setState('speaking');
  textBox.innerHTML = render(message);
  textBox.classList.add('error');
});

// A mark was not drawn: the screen changed since Judith looked at it.
window.judith.on('stale', () => {
  if (textBox.dataset.stale === '1') return;
  textBox.dataset.stale = '1';
  setState('speaking');
  textBox.innerHTML = "L'écran a bougé depuis que j'ai regardé : redemande-moi et je regarde à nouveau.";
});

window.judith.on('tool', (text) => {
  if (notch.dataset.state === 'speaking' && voice.speaking) return;
  setState('thinking');
  doing.textContent = `${text}…`;
});

// ----- asking -----
// heard: the spoken question, shown so the user sees what Judith understood.
function askJudith(text, heard = null) {
  if (!text) return;
  resetAnswer();
  answerDone = false;
  setState('thinking');
  doing.textContent = heard ? `« ${heard} »` : 'Je réfléchis à ta demande';
  window.judith.ask(text);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = question.value.trim();
  ears().cancel();
  askJudith(text);
});

question.addEventListener('input', () => {
  // Typing means the user prefers to write: stop listening.
  if (ears().listening && question.value) ears().cancel();
});

// ----- listening -----
const bars = document.querySelector('.bars');
// followUp: the short listening after an answer; silence just ends the
// conversation, and the marks stay on screen.
async function listen({ followUp = false } = {}) {
  if (ears().listening) return;
  if (!followUp) resetAnswer();
  setState('listening');
  question.value = '';
  question.placeholder = followUp ? 'Autre chose ? Je t’écoute…' : 'Parle, ou écris ta question…';
  question.focus();
  const onLevel = (level) => bars.style.setProperty('--level', level.toFixed(2));
  const noSpeechMs = followUp ? 5000 : 6000;
  try {
    if (live()) {
      // Words appear while the user talks; Deepgram knows when the sentence ends.
      await window.JudithLive.start({
        ...stt,
        onLevel,
        noSpeechMs,
        onPartial: (text) => {
          question.value = text;
          question.scrollLeft = question.scrollWidth;
        },
        onEnd: (text) => heardText(text, followUp),
      });
    } else {
      await recorder.start({
        onLevel,
        noSpeechMs,
        onEnd: (audio) => heard(audio, followUp),
        // After an answer: speak clearly, near the mic, for ~0.8 s at least.
        ...(followUp ? { speechLevel: 0.045, minVoiced: 6 } : {}),
      });
    }
  } catch (error) {
    question.placeholder = `Micro indisponible : ${error.message}. Écris ta question.`;
  }
}

// What Judith said last: if the mic "hears" it, it is her own echo.
let lastSpoken = '';

async function heardText(raw, followUp) {
  bars.style.setProperty('--level', '0');
  const text = followUp ? await window.judith.filterHeard(raw, lastSpoken) : raw;
  if (!text) {
    if (followUp) setState('none');
    else question.placeholder = "Je n'ai rien entendu. Parle, ou écris ta question…";
    return;
  }
  question.value = text;
  askJudith(text, text);
}

async function heard(audio, followUp = false) {
  bars.style.setProperty('--level', '0');
  if (!audio) {
    if (followUp) setState('none');
    else question.placeholder = "Je n'ai rien entendu. Parle, ou écris ta question…";
    return;
  }
  setState('thinking');
  doing.textContent = "J'écoute ce que tu as dit";
  try {
    let text = await window.judith.transcribe(audio);
    if (followUp) text = await window.judith.filterHeard(text, lastSpoken);
    if (!text && followUp) return setState('none');
    if (!text) {
      setState('listening');
      question.placeholder = "Je n'ai pas compris, tu peux répéter ?";
      return;
    }
    question.value = text;
    askJudith(text, text);
  } catch (error) {
    setState('listening');
    question.placeholder = error.message;
  }
}

document.getElementById('stop').addEventListener('click', () => ears().finish());

// ----- controls -----
function close() {
  resetAnswer();
  ears().cancel();
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
window.judith.on('focus', ({ listen: shouldListen, conversation: keepTalking, stt: ears_ } = {}) => {
  stt = ears_ ?? null;
  canListen = Boolean(shouldListen);
  conversation = Boolean(keepTalking);
  if (ears().listening) return ears().finish();
  if (shouldListen) listen();
  else {
    resetAnswer();
    setState('listening');
    question.focus();
  }
});
window.judith.on('idle', () => {
  ears().cancel();
  setState('none');
});
// A question sent by the app itself (demo mode).
window.judith.on('ask', (text) => {
  ears().cancel();
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
