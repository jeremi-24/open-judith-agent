// Draws Judith's marks: a hand-drawn ring, a numbered badge, a label and,
// for the first mark, a curved arrow coming from her bubble.
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
  }
}

// Quadratic curve from the bubble to the edge of the ring, bending sideways.
function drawArrow(from, m) {
  const dx = from.x - m.cx;
  const dy = from.y - m.cy;
  const distance = Math.hypot(dx, dy);
  if (distance < 80) return;

  const ux = dx / distance;
  const uy = dy / distance;
  const reach = Math.max(m.rx, m.ry) + 10;
  const end = { x: m.cx + ux * reach, y: m.cy + uy * reach };
  const bend = Math.min(120, distance * 0.25);
  const control = { x: (from.x + end.x) / 2 - uy * bend, y: (from.y + end.y) / 2 + ux * bend };
  const d = `M${from.x} ${from.y} Q${control.x} ${control.y} ${end.x} ${end.y}`;

  // Arrow head along the curve's last tangent.
  const angle = Math.atan2(end.y - control.y, end.x - control.x);
  const head = (a) => `${end.x - 14 * Math.cos(angle + a)} ${end.y - 14 * Math.sin(angle + a)}`;
  const tip = `M${head(0.5)} L${end.x} ${end.y} L${head(-0.5)}`;

  for (const path of [d, tip]) el('path', { class: 'halo', d: path });
  el('path', { class: 'arrow draw', d, pathLength: 1 });
  el('path', { class: 'arrow draw late', d: tip, pathLength: 1 });
}

function clear() {
  canvas.replaceChildren();
  labels.replaceChildren();
}

window.judith.on('clear', clear);
window.judith.on('marks', ({ marks, anchor }) => {
  clear();
  marks.forEach(drawRing);
  if (marks[0] && anchor) drawArrow(anchor, marks[0]);
});
