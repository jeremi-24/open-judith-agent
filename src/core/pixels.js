// Did the screen change under a mark? Compares the same region of two small
// raw screenshots (BGRA, as Electron's toBitmap gives them).
//
// What counts is the structure (text, shapes), not the tint: translucent
// surfaces like the Windows taskbar change color when focus moves, and that
// is not a change for the user. A one-pixel jitter is tolerated too.

function luminances(img, x1, y1, x2, y2, exclude) {
  const values = [];
  const keep = [];
  for (let y = y1; y <= y2; y += 1) {
    for (let x = x1; x <= x2; x += 1) {
      const fx = x / img.width;
      const fy = y / img.height;
      keep.push(!exclude.some((r) => fx >= r.x1 && fx <= r.x2 && fy >= r.y1 && fy <= r.y2));
      const i = (y * img.width + x) * 4;
      values.push(0.11 * img.data[i] + 0.59 * img.data[i + 1] + 0.3 * img.data[i + 2]);
    }
  }
  return { values, keep };
}

const mean = (values, keep) => {
  let total = 0;
  let count = 0;
  values.forEach((v, i) => {
    if (keep[i]) {
      total += v;
      count += 1;
    }
  });
  return count ? total / count : 0;
};

// rect: fractions of the screen { x1, y1, x2, y2 }.
// exclude: rects to ignore (Judith's own notch and board, which move).
// Returns a difference score, 0 (same) to 255.
export function regionDiff(a, b, rect, exclude = []) {
  if (!a || !b || a.width !== b.width || a.height !== b.height) return 255;
  const x1 = Math.max(1, Math.floor(rect.x1 * a.width));
  const x2 = Math.min(a.width - 2, Math.ceil(rect.x2 * a.width));
  const y1 = Math.max(1, Math.floor(rect.y1 * a.height));
  const y2 = Math.min(a.height - 2, Math.ceil(rect.y2 * a.height));
  if (x2 < x1 || y2 < y1) return 0;

  const before = luminances(a, x1, y1, x2, y2, exclude);
  const meanBefore = mean(before.values, before.keep);
  let best = Infinity;
  let meanGap = 0;
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const after = luminances(b, x1 + dx, y1 + dy, x2 + dx, y2 + dy, exclude);
    const meanAfter = mean(after.values, after.keep);
    let total = 0;
    let count = 0;
    before.values.forEach((v, i) => {
      if (!before.keep[i]) return;
      total += Math.abs(v - meanBefore - (after.values[i] - meanAfter));
      count += 1;
    });
    const structure = count ? total / count : 0;
    if (structure < best) {
      best = structure;
      meanGap = Math.abs(meanBefore - meanAfter);
    }
  }
  // A big brightness jump still counts (a light page replaced by a dark one).
  return best + 0.3 * meanGap;
}

// The area a mark covers, with a small margin, as fractions of the screen.
export function markRect(mark, margin = 0.01) {
  const w = Math.max(mark.w ?? 0, 0.02);
  const h = Math.max(mark.h ?? 0, 0.02);
  return {
    x1: Math.max(0, mark.x - w / 2 - margin),
    y1: Math.max(0, mark.y - h / 2 - margin),
    x2: Math.min(1, mark.x + w / 2 + margin),
    y2: Math.min(1, mark.y + h / 2 + margin),
  };
}

// Above this score, what was under the mark is gone (page changed,
// scrolled, other window), compared with a baseline taken once the marks are
// on screen.
export const CHANGED = 14;
// Before drawing, the reference is the screenshot Judith looked at, a few
// seconds older and taken with her windows hidden: some surfaces (taskbar
// search box, focus tints) drift on their own, so only big changes count.
export const STALE = 40;
