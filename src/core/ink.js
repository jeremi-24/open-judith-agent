// Judith's ink: contours drawn as if by hand. A gentle, low-frequency wobble,
// a start that is never exactly the end (the pen overshoots a little), and
// a colour that stays readable on whatever is underneath.

// Small seeded random generator: the same mark always gets the same stroke.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Points around the mark (pixels), clockwise, starting top-left like a hand.
export function outlinePoints(m, count = 56) {
  if (m.shape === 'shape' && m.points?.length >= 3) return densify(m.points, count);
  if (m.shape === 'box') return roundedBox(m, count);
  const points = [];
  for (let i = 0; i < count; i++) {
    const a = -2.3 + (i / count) * Math.PI * 2;
    points.push([m.cx + Math.cos(a) * m.rx, m.cy + Math.sin(a) * m.ry]);
  }
  return points;
}

function roundedBox(m, count) {
  const r = Math.min(14, m.rx, m.ry);
  const [x1, y1, x2, y2] = [m.cx - m.rx, m.cy - m.ry, m.cx + m.rx, m.cy + m.ry];
  // Corners as small arcs, then sampled evenly along the perimeter.
  const corners = [
    [x1 + r, y1 + r, Math.PI, 1.5 * Math.PI],
    [x2 - r, y1 + r, 1.5 * Math.PI, 2 * Math.PI],
    [x2 - r, y2 - r, 0, 0.5 * Math.PI],
    [x1 + r, y2 - r, 0.5 * Math.PI, Math.PI],
  ];
  const path = [];
  for (const [cx, cy, from, to] of corners) {
    for (let i = 0; i <= 6; i++) {
      const a = from + ((to - from) * i) / 6;
      path.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  return densify(path, count);
}

// Evenly spaced points along a closed polyline.
export function densify(points, count) {
  const closed = [...points, points[0]];
  const lengths = [0];
  for (let i = 1; i < closed.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(closed[i][0] - closed[i - 1][0], closed[i][1] - closed[i - 1][1]));
  }
  const total = lengths.at(-1) || 1;
  const out = [];
  let j = 1;
  for (let k = 0; k < count; k++) {
    const target = (k / count) * total;
    while (j < lengths.length - 1 && lengths[j] < target) j++;
    const span = lengths[j] - lengths[j - 1] || 1;
    const t = (target - lengths[j - 1]) / span;
    const [a, b] = [closed[j - 1], closed[j]];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

// The hand-drawn version of a closed outline, as an open SVG path that runs
// a bit past its start. wobble: how far (px) the hand drifts.
export function handStroke(points, seed, { wobble = 2.5, overshoot = 0.08 } = {}) {
  const random = rng(seed);
  const n = points.length;
  // Two slow waves with random phases: the hand drifts, it does not shake.
  const phase1 = random() * Math.PI * 2;
  const phase2 = random() * Math.PI * 2;
  const drift = (t) => wobble * (0.65 * Math.sin(t * Math.PI * 2 * 2 + phase1) + 0.35 * Math.sin(t * Math.PI * 2 * 5 + phase2));

  const extra = Math.max(2, Math.round(n * overshoot));
  const path = [];
  for (let i = 0; i <= n + extra; i++) {
    const p = points[i % n];
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    // Normal to the outline at this point.
    let nx = -(next[1] - prev[1]);
    let ny = next[0] - prev[0];
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    // The pen starts a little inside and ends a little outside: not a perfect loop.
    const t = i / n;
    const spiral = (t - 0.5) * wobble * 1.2;
    const off = drift(t) + spiral;
    path.push([p[0] + nx * off, p[1] + ny * off]);
  }
  return { d: openCurve(path), start: path[0], points: path };
}

// Smooth open curve through the points (Catmull-Rom → cubic Bézier).
export function openCurve(points) {
  const p = (i) => points[Math.max(0, Math.min(points.length - 1, i))];
  const r = (v) => Math.round(v * 10) / 10;
  let d = `M${r(p(0)[0])} ${r(p(0)[1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, p1, p2, p3] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${r(c1[0])} ${r(c1[1])} ${r(c2[0])} ${r(c2[1])} ${r(p2[0])} ${r(p2[1])}`;
  }
  return d;
}

// Dark ink on light backgrounds, light ink on dark ones.
// luma: average brightness (0..255) under the mark.
export function inkFor(luma) {
  return luma >= 140 ? 'dark' : 'light';
}

// A hand-drawn line under a word, a title or a number (pixels): almost
// straight, with a slow drift, never ruler-flat.
export function underlineStroke(a, b, seed) {
  const random = rng(seed);
  const phase = random() * Math.PI * 2;
  const drift = 1 + random() * 1.5;
  const points = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + Math.sin(t * Math.PI * 2 + phase) * drift]);
  }
  return { d: openCurve(points), start: points[0], points };
}

// A hand-drawn arrow from a to b (pixels): a slightly bent stroke and a head.
// The bend side and size come from the seed, so two arrows never look stamped.
export function arrowStroke(a, b, seed) {
  const random = rng(seed);
  const [x1, y1] = a;
  const [x2, y2] = b;
  const length = Math.hypot(x2 - x1, y2 - y1) || 1;
  const [ux, uy] = [(x2 - x1) / length, (y2 - y1) / length];
  // Bend: up to 8% of the length, on a random side.
  const bend = (random() < 0.5 ? -1 : 1) * length * (0.04 + random() * 0.04);
  const mid = [(x1 + x2) / 2 - uy * bend, (y1 + y2) / 2 + ux * bend];
  const points = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const q = (1 - t) * (1 - t);
    points.push([q * x1 + 2 * (1 - t) * t * mid[0] + t * t * x2, q * y1 + 2 * (1 - t) * t * mid[1] + t * t * y2]);
  }
  // The head follows the direction of the end of the stroke.
  const [px, py] = points[points.length - 3];
  const angle = Math.atan2(y2 - py, x2 - px);
  const head = Math.min(18, Math.max(10, length * 0.12));
  const wing = (side) => [x2 - head * Math.cos(angle + side * 0.5), y2 - head * Math.sin(angle + side * 0.5)];
  const [l, r] = [wing(1), wing(-1)];
  const round = (v) => Math.round(v * 10) / 10;
  return {
    d: openCurve(points),
    head: `M${round(l[0])} ${round(l[1])} L${round(x2)} ${round(y2)} L${round(r[0])} ${round(r[1])}`,
    start: points[0],
    points,
  };
}
