// The board: notes and visuals Judith builds while she explains, and the
// list of everything Claude Code did (commands, files, visuals).
const title = document.getElementById('title');
const subtitle = document.getElementById('subtitle');
const notes = document.getElementById('notes');
const visual = document.getElementById('visual');
const frame = document.getElementById('frame');
const activity = document.getElementById('activity');
const actions = document.getElementById('actions');

function render(text) {
  return text
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

// Visuals are untrusted HTML written by the model: main serves each one from
// judith-frame://visual/<id> with its own CSP (no network), in a sandboxed
// frame that reports its height so the frame fits (src/main/frames.js).
function showVisual(name, src) {
  visual.hidden = false;
  document.getElementById('visual-title').textContent = name;
  frame.src = src;
  frame.style.height = '280px';
}
window.addEventListener('message', (event) => {
  if (event.source === frame.contentWindow && Number.isFinite(event.data?.judithHeight)) {
    frame.style.height = `${Math.min(900, Math.max(120, event.data.judithHeight + 4))}px`;
  }
});

window.judith.on('board', (data) => {
  title.textContent = data.title;
  subtitle.textContent = data.subtitle ?? '';
  notes.replaceChildren();
});
window.judith.on('note', ({ text }) => {
  const li = document.createElement('li');
  li.innerHTML = `<span>${render(text)}</span>`;
  notes.append(li);
  li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
});
window.judith.on('visual', ({ title: name, src }) => showVisual(name, src));

// 3D scenes: the model's code runs in a fresh sandboxed frame (scene.html,
// served from judith-frame://scene/),
// thrown away at each new scene. The frame says whether the code worked;
// Judith passes it on, so the model can fix it or explain otherwise.
const scene = document.getElementById('scene');
const sceneBox = document.getElementById('scene-box');
const seen = document.getElementById('seen');
let sceneFrame = null;
let sceneId = 0;
let sceneCode = '';
function showScene({ id, title: name, code, seenImage }) {
  scene.hidden = false;
  document.getElementById('scene-title').textContent = name;
  seen.hidden = !seenImage;
  if (seenImage) document.getElementById('seen-img').src = seenImage;
  sceneId = id;
  sceneCode = code;
  sceneFrame?.remove();
  sceneFrame = Object.assign(document.createElement('iframe'), { title: name, src: 'judith-frame://scene/scene.html' });
  sceneFrame.setAttribute('sandbox', 'allow-scripts');
  sceneBox.append(sceneFrame);
  scene.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
window.addEventListener('message', (event) => {
  if (!sceneFrame || event.source !== sceneFrame.contentWindow) return;
  const data = event.data?.judithScene;
  if (!data) return;
  if (data.ready) return sceneFrame.contentWindow.postMessage({ judithCode: sceneCode }, '*');
  if (data.warning) return window.judith.log(`[scene] ${String(data.warning).slice(0, 300)}`);
  window.judith.sceneResult({ id: sceneId, ok: Boolean(data.ok), error: data.error ? String(data.error).slice(0, 600) : undefined });
});
window.judith.on('scene', showScene);
// The voice reached "scene n": move to that step.
window.judith.on('scene-step', ({ step }) => sceneFrame?.contentWindow.postMessage({ judithStep: step }, '*'));

// One card per action; it turns green or red when Claude Code is done.
const cards = new Map();
window.judith.on('activity', (item) => {
  activity.hidden = false;
  let card = cards.get(item.id);
  if (!card) {
    card = document.createElement('li');
    card.className = 'act';
    card.innerHTML = '<div class="act-head"><span class="state"></span><span class="act-label"></span></div>';
    cards.set(item.id, card);
    actions.append(card);
  }
  card.dataset.status = item.status;
  card.querySelector('.act-label').textContent = item.label;

  if (item.detail && !card.querySelector('.act-detail')) {
    card.append(Object.assign(document.createElement('div'), { className: 'act-detail', textContent: item.detail }));
  }
  if (item.output && !card.querySelector('details')) {
    const details = document.createElement('details');
    details.innerHTML = '<summary>Voir le résultat</summary><pre></pre>';
    details.querySelector('pre').textContent = item.output;
    card.append(details);
  }
  if (item.file && item.status === 'ok' && !card.querySelector('.act-buttons')) {
    const buttons = document.createElement('div');
    buttons.className = 'act-buttons';
    const add = (text, onClick) => buttons.append(Object.assign(document.createElement('button'), { type: 'button', textContent: text, onclick: onClick }));
    if (item.previewable) add('Aperçu ici', () => window.judith.preview(item.file));
    add('Ouvrir', () => window.judith.openPath(item.file));
    card.append(buttons);
  }
  card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
});

window.judith.on('clear-board', () => {
  title.textContent = 'Judith';
  subtitle.textContent = '';
  notes.replaceChildren();
  visual.hidden = true;
  frame.removeAttribute('src');
  scene.hidden = true;
  sceneFrame?.remove();
  sceneFrame = null;
  activity.hidden = true;
  actions.replaceChildren();
  cards.clear();
});

document.getElementById('close').addEventListener('click', () => window.judith.closeBoard());

// The window follows the natural height of the board (header + content);
// when the screen is too short, the paper scrolls.
const header = document.querySelector('header');
const content = document.getElementById('content');
const fit = () => window.judith.resizeBoard(header.offsetHeight + content.offsetHeight + 26 + 24);
new ResizeObserver(fit).observe(content);
new ResizeObserver(fit).observe(header);
