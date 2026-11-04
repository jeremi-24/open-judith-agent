// Snapping a mark onto the real control under it.
//
// The model gives an approximate box from a screenshot (often ~30 px off on
// small icons). Windows knows exactly where each control is (UI Automation):
// the "eyes" companion returns the elements around the mark's centre, and
// pickSnap chooses the one the model meant. The mark is then drawn on its
// real bounds.
//
// Everything here is in fractions of the display (like marks), so it does not
// depend on DPI or on which monitor Judith is on.

// Controls a user clicks or reads: a match on one of them is worth more than
// on a pane or a whole window.
const PRECISE = new Set(['Button', 'MenuItem', 'TabItem', 'Hyperlink', 'CheckBox', 'RadioButton', 'ComboBox', 'Edit', 'ListItem', 'TreeItem', 'SplitButton', 'Image', 'Text', 'DataItem', 'HeaderItem', 'Slider', 'Spinner']);

// Lower case, without accents or punctuation: "Exporter…" ≈ "exporter".
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// 1: same words; 0.6: one contains the other; 0 otherwise.
export function nameScore(label, name) {
  const a = normalize(label);
  const b = normalize(name);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (b.includes(a) || (a.length > 3 && a.includes(b) && b.length > 2)) return 0.6;
  return 0;
}

const area = (r) => Math.max(0, r.x2 - r.x1) * Math.max(0, r.y2 - r.y1);
function iou(a, b) {
  const inter = area({ x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), x2: Math.min(a.x2, b.x2), y2: Math.min(a.y2, b.y2) });
  const union = area(a) + area(b) - inter;
  return union > 0 ? inter / union : 0;
}
const contains = (r, x, y) => x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2;

// model: { x1, y1, x2, y2 } (the model's box); label: its label;
// candidates: [{ name, type, rect: { x1, y1, x2, y2 } }].
// → the chosen candidate's rect, or null (keep the model's box).
export function pickSnap(model, label, candidates) {
  const cx = (model.x1 + model.x2) / 2;
  const cy = (model.y1 + model.y2) / 2;
  const modelArea = Math.max(area(model), 1e-6);
  let best = null;
  for (const candidate of candidates ?? []) {
    const r = candidate.rect;
    const size = area(r);
    if (!(size > 0)) continue;
    // A whole window or panel is never what a mark means.
    if (size > 0.25 || size > modelArea * 12) continue;
    // The model's centre must be on the element, or very close for tiny icons.
    const near = contains(r, cx, cy) || contains({ x1: r.x1 - 0.01, y1: r.y1 - 0.015, x2: r.x2 + 0.01, y2: r.y2 + 0.015 }, cx, cy);
    if (!near) continue;
    const overlap = iou(model, r);
    const named = nameScore(label, candidate.name);
    // Too different in size, without the right name: not the same thing.
    if (overlap < 0.2 && named < 0.6) continue;
    // The name is the strongest clue: a perfect overlap on the wrong control
    // must lose to the control that carries the label.
    const score = overlap + named + (PRECISE.has(candidate.type) ? 0.1 : 0);
    if (!best || score > best.score) best = { score, rect: r };
  }
  return best ? { ...best.rect } : null;
}

// The mark on the snapped rect: same shape and label, real position and size.
export function snapMark(mark, rect) {
  if (!rect) return mark;
  return { ...mark, x: (rect.x1 + rect.x2) / 2, y: (rect.y1 + rect.y2) / 2, w: rect.x2 - rect.x1, h: rect.y2 - rect.y1, snapped: true };
}

// The model's box of a ring or box mark (fractions of the display).
export const markBox = (mark) => ({ x1: mark.x - mark.w / 2, y1: mark.y - mark.h / 2, x2: mark.x + mark.w / 2, y2: mark.y + mark.h / 2 });
