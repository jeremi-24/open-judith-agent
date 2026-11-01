// Converts a mark from the script (fractions of the screenshot) to pixels
// inside a display of the given size.
const MIN_RADIUS = 14;
const MARGIN = 4; // the contour sits just outside the element

export function toPixels(mark, size) {
  const cx = Math.round(mark.x * size.width);
  const cy = Math.round(mark.y * size.height);
  const rx = Math.max(MIN_RADIUS, Math.round(((mark.w ?? 0) * size.width) / 2) + MARGIN);
  const ry = Math.max(MIN_RADIUS, Math.round(((mark.h ?? 0) * size.height) / 2) + MARGIN);
  const points = mark.points?.map(([x, y]) => [Math.round(x * size.width), Math.round(y * size.height)]);
  return { ...mark, cx, cy, rx, ry, ...(points ? { points } : {}) };
}
