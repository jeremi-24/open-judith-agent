// Draws Judith's marks one by one, as she talks: a double contour (ellipse,
// rounded box or free outline hugging the object), a numbered badge and a
// label; her pointer lands next to the first mark.
const canvas = document.getElementById('canvas');
const labels = document.getElementById('labels');
const SVG = 'http://www.w3.org/2000/svg';
let count = 0;

function el(name, attrs, parent = canvas) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  parent.append(node);
  return node;
}

// Smooth closed curve through the points (Catmull-Rom → cubic Bézier).
function smoothPath(points) {
  const n = points.length;
  const p = (i) => points[(i + n) % n];
  let d = `M${p(0)[0]} ${p(0)[1]}`;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${p2[0]} ${p2[1]}`;
  }
  return `${d}Z`;
}

// The contour, twice (iris then sky, slightly offset) over a white halo.
function contour(m) {
  if (m.shape === 'shape' && m.points?.length >= 3) {
    const d = smoothPath(m.points);
    el('path', { class: 'halo', d });
    el('path', { class: 'ink draw', d, pathLength: 1 });
    el('path', { class: 'ink-2 draw late', d, pathLength: 1, transform: 'translate(2 1.5)' });
    return;
  }
  if (m.shape === 'box') {
    const box = (grow) => ({
      x: m.cx - m.rx - grow, y: m.cy - m.ry - grow,
      width: 2 * (m.rx + grow), height: 2 * (m.ry + grow),
      rx: Math.min(18, m.ry + grow), pathLength: 1,
    });
    el('rect', { class: 'halo', ...box(0) });
    el('rect', { class: 'ink draw', ...box(0) });
    el('rect', { class: 'ink-2 draw late', ...box(3) });
    return;
  }
  const ellipse = (rotate, grow) => ({
    cx: m.cx, cy: m.cy, rx: m.rx + grow, ry: m.ry + grow,
    transform: `rotate(${rotate} ${m.cx} ${m.cy})`, pathLength: 1,
  });
  el('ellipse', { class: 'halo', ...ellipse(-4, 0) });
  el('ellipse', { class: 'ink draw', ...ellipse(-4, 0) });
  el('ellipse', { class: 'ink-2 draw late', ...ellipse(3, 3) });
}

function badge(m, n) {
  const x = m.cx - m.rx * 0.85;
  const y = m.cy - m.ry - 2;
  el('circle', { class: 'badge pop', cx: x, cy: y, r: 10 });
  el('text', { class: 'badge-text pop', x, y }).textContent = String(n);
}

function label(m, n) {
  if (!m.label) return;
  const pill = document.createElement('div');
  pill.className = 'pill label';
  pill.style.left = `${m.cx}px`;
  pill.style.top = `${m.cy + m.ry + 8}px`;
  pill.append(Object.assign(document.createElement('span'), { className: 'n', textContent: String(n) }), document.createTextNode(m.label));
  labels.append(pill);
  keepOnScreen(pill, m);
  avoidOverlap(pill);
}

function pointer(m) {
  const node = document.createElement('div');
  node.className = 'pointer';
  node.style.left = `${m.cx + m.rx * 0.5}px`;
  node.style.top = `${m.cy + m.ry * 0.35}px`;
  node.innerHTML =
    '<svg viewBox="0 0 110 70" aria-hidden="true"><path d="M0 0L0 30L8 22.5L14.5 36L19 34L13 21.5L24 21.5Z" fill="#5CB8FF" stroke="#FFFFFF" stroke-width="3" stroke-linejoin="round"/>' +
    '<rect x="26" y="36" width="80" height="30" rx="15" fill="#6B57E8"/><text x="66" y="56" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="14" font-weight="600" fill="#FFFFFF">Judith</text></svg>';
  labels.append(node);
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
  count = 0;
  canvas.replaceChildren();
  labels.replaceChildren();
}

function scan(on) {
  document.getElementById('scan').hidden = !on;
  document.getElementById('scan-pill').hidden = !on;
}

window.judith.on('clear', clear);
window.judith.on('scan', scan);
window.judith.on('mark', (m) => {
  scan(false);
  count += 1;
  contour(m);
  badge(m, count);
  label(m, count);
  if (count === 1) pointer(m);
});
