// Draws Judith's marks as she talks. For each mark, her pen flies to where
// the stroke starts, then traces it by hand (a slight wobble, a start that
// is not exactly the end); the badge and the label pop in after. The ink is
// dark on light backgrounds and light on dark ones. Marks are drawn one
// after the other, never at the same time.
import { handStroke, outlinePoints } from '../core/ink.js';

const canvas = document.getElementById('canvas');
const labels = document.getElementById('labels');
const SVG = 'http://www.w3.org/2000/svg';
const FLY_MS = 380;
const TRACE_MS = 650;

let count = 0;
let queue = Promise.resolve();
let generation = 0; // a clear cancels the drawings still in the queue
let pen = null;
let penAt = null;

function el(name, attrs, parent = canvas) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  parent.append(node);
  return node;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

// ----- Judith's pen -----
function ensurePen() {
  if (pen) return pen;
  pen = document.createElement('div');
  pen.className = 'pen';
  pen.innerHTML =
    '<svg viewBox="0 0 66 42" aria-hidden="true"><path d="M0 0L0 18L4.8 13.5L8.7 21.6L11.4 20.4L7.8 12.9H14.4Z"/>' +
    '<rect x="16" y="22" width="48" height="18" rx="9"/><text x="40" y="34.5">Judith</text></svg>';
  labels.append(pen);
  return pen;
}

function placePen(x, y) {
  penAt = [x, y];
  pen.style.transform = `translate(${x}px, ${y}px)`;
}

async function flyTo(x, y, mine) {
  ensurePen();
  if (!penAt) {
    // First mark: the pen comes from a little below and to the right.
    placePen(x + 40, y + 40);
    pen.classList.add('shown');
    await wait(20);
  }
  const [x0, y0] = penAt;
  const start = performance.now();
  while (mine === generation) {
    const t = Math.min(1, (performance.now() - start) / FLY_MS);
    const k = ease(t);
    // A slight arc, like a hand moving over the page.
    const lift = Math.sin(Math.PI * t) * Math.min(60, Math.hypot(x - x0, y - y0) * 0.15);
    placePen(x0 + (x - x0) * k, y0 + (y - y0) * k - lift);
    if (t === 1) break;
    await new Promise(requestAnimationFrame);
  }
}

// The pen follows the path while the stroke (and its halo) appears behind it.
async function trace(paths, mine) {
  const [path] = paths.slice(-1);
  const total = path.getTotalLength();
  for (const p of paths) {
    p.style.strokeDasharray = `${total}`;
    p.style.strokeDashoffset = `${total}`;
  }
  const start = performance.now();
  while (mine === generation) {
    const t = Math.min(1, (performance.now() - start) / TRACE_MS);
    const k = ease(t);
    for (const p of paths) p.style.strokeDashoffset = `${total * (1 - k)}`;
    const p = path.getPointAtLength(total * k);
    placePen(p.x, p.y);
    if (t === 1) break;
    await new Promise(requestAnimationFrame);
  }
}

// ----- a mark -----
async function drawMark(m, mine) {
  const group = el('g', { class: `mark ink-${m.ink === 'light' ? 'light' : 'dark'}` });
  const outline = outlinePoints(m);
  const size = Math.max(m.rx, m.ry);
  const stroke = handStroke(outline, m.seed ?? 1, { wobble: Math.min(3.2, 1.2 + size * 0.02) });
  const echo = handStroke(outline, (m.seed ?? 1) + 101, { wobble: Math.min(3.2, 1.2 + size * 0.02) });

  const halo = el('path', { class: 'halo', d: stroke.d }, group);
  const main = el('path', { class: 'ink', d: stroke.d }, group);
  const second = el('path', { class: 'ink-2', d: echo.d, transform: 'translate(1.5 1)' }, group);
  second.style.opacity = '0';

  await flyTo(stroke.start[0], stroke.start[1], mine);
  if (mine !== generation) return;
  await trace([halo, main], mine);
  if (mine !== generation) return;
  second.style.opacity = '';
  second.classList.add('fade-in');

  count += 1;
  badge(m, count, group);
  label(m, count, m.ink);
  // The pen rests next to the mark, ready for the next one.
  await flyTo(m.cx + m.rx * 0.6, m.cy + m.ry * 0.5, mine);
}

function badge(m, n, group) {
  const x = m.cx - m.rx * 0.85;
  const y = m.cy - m.ry - 2;
  el('circle', { class: 'badge pop', cx: x, cy: y, r: 10 }, group);
  el('text', { class: 'badge-text pop', x, y }, group).textContent = String(n);
}

function label(m, n, ink) {
  if (!m.label) return;
  const pill = document.createElement('div');
  pill.className = `pill label${ink === 'light' ? ' on-dark' : ''}`;
  pill.style.left = `${m.cx}px`;
  pill.style.top = `${m.cy + m.ry + 8}px`;
  pill.append(Object.assign(document.createElement('span'), { className: 'n', textContent: String(n) }), document.createTextNode(m.label));
  labels.append(pill);
  keepOnScreen(pill, m);
  avoidOverlap(pill);
}

function keepOnScreen(pill, m) {
  const r = pill.getBoundingClientRect();
  if (r.bottom > window.innerHeight - 6) pill.style.top = `${m.cy - m.ry - r.height - 10}px`;
  if (r.left < 6) pill.style.left = `${parseFloat(pill.style.left) - r.left + 6}px`;
  if (r.right > window.innerWidth - 6) pill.style.left = `${parseFloat(pill.style.left) - (r.right - window.innerWidth) - 6}px`;
}

// Labels of marks close together would stack: push the new one down.
function avoidOverlap(pill) {
  const others = [...labels.querySelectorAll('.label')].filter((l) => l !== pill);
  for (let tries = 0; tries < 6; tries++) {
    const r = pill.getBoundingClientRect();
    const hit = others.map((o) => o.getBoundingClientRect()).find((o) => r.left < o.right && o.left < r.right && r.top < o.bottom && o.top < r.bottom);
    if (!hit) return;
    pill.style.top = `${hit.bottom + 6}px`;
  }
}

function clear() {
  generation += 1;
  queue = Promise.resolve();
  count = 0;
  canvas.replaceChildren();
  labels.replaceChildren();
  pen = null;
  penAt = null;
}

function scan(on) {
  document.getElementById('scan').hidden = !on;
  document.getElementById('scan-pill').hidden = !on;
}

window.judith.on('clear', clear);
window.judith.on('scan', scan);
window.judith.on('mark', (m) => {
  scan(false);
  const mine = generation;
  queue = queue.then(() => (mine === generation ? drawMark(m, mine) : null)).catch(() => {});
});
