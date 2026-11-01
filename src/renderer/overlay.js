// Draws Judith's marks right on the target: a hand-drawn ring, a numbered
// badge, a label, and Judith's own pointer landing next to the first one.
// No long arrow from the notch: the mark speaks for itself.
const canvas = document.getElementById('canvas');
const labels = document.getElementById('labels');
const SVG = 'http://www.w3.org/2000/svg';

function el(name, attrs, parent = canvas) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  parent.append(node);
  return node;
}

function ellipse(m, className, rotate, grow = 0) {
  return el('ellipse', {
    class: className,
    cx: m.cx, cy: m.cy, rx: m.rx + grow, ry: m.ry + grow,
    transform: `rotate(${rotate} ${m.cx} ${m.cy})`,
    pathLength: 1,
  });
}

function drawRing(m) {
  ellipse(m, 'halo', -3, 2);
  ellipse(m, 'ring draw', -3, 2);
  ellipse(m, 'ring echo draw late', 2, 5);

  const bx = m.cx - m.rx * 0.8;
  const by = m.cy - m.ry - 4;
  el('circle', { class: 'badge', cx: bx, cy: by, r: 12 });
  el('text', { class: 'badge-text', x: bx, y: by }).textContent = String(m.step);

  if (m.label) {
    const label = document.createElement('div');
    label.className = 'label';
    label.style.left = `${m.cx}px`;
    label.style.top = `${m.cy + m.ry + 12}px`;
    const n = Object.assign(document.createElement('span'), { className: 'n', textContent: String(m.step) });
    label.append(n, document.createTextNode(m.label));
    labels.append(label);
    keepOnScreen(label);
    avoidOverlap(label);
  }
}

// Judith's pointer lands at the bottom right of the ring, pointing at it.
function drawPointer(m) {
  const pointer = document.createElement('div');
  pointer.className = 'pointer';
  pointer.style.left = `${m.cx + m.rx * 0.55}px`;
  pointer.style.top = `${m.cy + m.ry * 0.45}px`;
  pointer.innerHTML = '<svg viewBox="0 0 22 30" aria-hidden="true"><path d="M2 2v22l6-5.5 4.5 9.5 4-1.8-4.4-9.2H20Z"/></svg><span>Judith</span>';
  labels.append(pointer);
}

function keepOnScreen(label) {
  const r = label.getBoundingClientRect();
  if (r.bottom > window.innerHeight - 4) label.style.top = `${parseFloat(label.style.top) - r.height - 2 * 12 - 40}px`;
  if (r.left < 4) label.style.left = `${parseFloat(label.style.left) - r.left + 4}px`;
  if (r.right > window.innerWidth - 4) label.style.left = `${parseFloat(label.style.left) - (r.right - window.innerWidth) - 4}px`;
}

// Two marks close together would stack their labels: push the new one down.
function avoidOverlap(label) {
  const others = [...labels.children].filter((l) => l !== label && l.classList.contains('label'));
  for (let tries = 0; tries < 6; tries++) {
    const r = label.getBoundingClientRect();
    const hit = others.map((o) => o.getBoundingClientRect()).find((o) => r.left < o.right && o.left < r.right && r.top < o.bottom && o.top < r.bottom);
    if (!hit) return;
    label.style.top = `${hit.bottom + 6}px`;
  }
}

function clear() {
  canvas.replaceChildren();
  labels.replaceChildren();
}

window.judith.on('clear', clear);
window.judith.on('marks', ({ marks }) => {
  clear();
  marks.forEach(drawRing);
  if (marks[0]) drawPointer(marks[0]);
});
