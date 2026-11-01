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

// Average brightness (0..255) of a region of a small raw screenshot: tells
// which ink stays readable on it.
export function averageLuma(img, rect) {
  if (!img) return 255;
  const x1 = Math.max(0, Math.floor(rect.x1 * img.width));
  const x2 = Math.min(img.width - 1, Math.ceil(rect.x2 * img.width));
  const y1 = Math.max(0, Math.floor(rect.y1 * img.height));
  const y2 = Math.min(img.height - 1, Math.ceil(rect.y2 * img.height));
  let total = 0;
  let count = 0;
  for (let y = y1; y <= y2; y += 2) {
    for (let x = x1; x <= x2; x += 2) {
      const i = (y * img.width + x) * 4;
      total += 0.11 * img.data[i] + 0.59 * img.data[i + 1] + 0.3 * img.data[i + 2];
      count += 1;
    }
  }
  return count ? total / count : 255;
}

// The heart of the marked element (its central part, no margin): what must
// not have moved. Its surroundings may live their own life (a progress bar,
// a clock) without making the mark wrong.
export function markCore(mark, keep = 0.7) {
  const w = Math.max((mark.w ?? 0) * keep, 0.012);
  const h = Math.max((mark.h ?? 0) * keep, 0.012);
  return {
    x1: Math.max(0, mark.x - w / 2),
    y1: Math.max(0, mark.y - h / 2),
    x2: Math.min(1, mark.x + w / 2),
    y2: Math.min(1, mark.y + h / 2),
  };
}

// Where did the content of a region go? Looks for the same pattern in the
// newer screenshot, moved by up to maxShift pixels (small-image pixels).
// Returns the best match: { diff, dx, dy }. A mark can then follow its
// content (taskbar icons re-centred, a page scrolled a little) instead of
// pointing at the old place.
export function bestShift(a, b, rect, exclude = [], maxShift = 24) {
  if (!a || !b || a.width !== b.width || a.height !== b.height) return { diff: 255, dx: 0, dy: 0 };
  const x1 = Math.max(0, Math.floor(rect.x1 * a.width));
  const x2 = Math.min(a.width - 1, Math.ceil(rect.x2 * a.width));
  const y1 = Math.max(0, Math.floor(rect.y1 * a.height));
  const y2 = Math.min(a.height - 1, Math.ceil(rect.y2 * a.height));
  const luma = (img, x, y) => {
    const i = (y * img.width + x) * 4;
    return 0.11 * img.data[i] + 0.59 * img.data[i + 1] + 0.3 * img.data[i + 2];
  };
  const samples = [];
  for (let y = y1; y <= y2; y += 2) {
    for (let x = x1; x <= x2; x += 2) {
      const fx = x / a.width;
      const fy = y / a.height;
      if (!exclude.some((r) => fx >= r.x1 && fx <= r.x2 && fy >= r.y1 && fy <= r.y2)) samples.push([x, y, luma(a, x, y)]);
    }
  }
  if (!samples.length) return { diff: 0, dx: 0, dy: 0 };
  const meanA = samples.reduce((s, p) => s + p[2], 0) / samples.length;

  let best = { diff: Infinity, dx: 0, dy: 0 };
  for (let dy = -maxShift; dy <= maxShift; dy += 1) {
    for (let dx = -maxShift; dx <= maxShift; dx += 1) {
      let sumB = 0;
      let n = 0;
      const values = [];
      for (const [x, y] of samples) {
        const bx = x + dx;
        const by = y + dy;
        if (bx < 0 || by < 0 || bx >= b.width || by >= b.height) {
          values.push(null);
          continue;
        }
        const v = luma(b, bx, by);
        values.push(v);
        sumB += v;
        n += 1;
      }
      if (n < samples.length * 0.8) continue;
      const meanB = sumB / n;
      let total = 0;
      samples.forEach(([, , va], i) => {
        if (values[i] !== null) total += Math.abs(va - meanA - (values[i] - meanB));
      });
      // Small preference for no move: equal matches keep the mark in place.
      const diff = total / n + 0.3 * Math.abs(meanA - meanB) + 0.05 * (Math.abs(dx) + Math.abs(dy));
      if (diff < best.diff) best = { diff, dx, dy };
    }
  }
  return best;
}
