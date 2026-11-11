// The zone of the screen the user drew for Judith. Claude only sees that
// part, so its coordinates are fractions of the zone, and must be brought
// back to the whole display before drawing. All rects are fractions of the
// display: { x1, y1, x2, y2 }.

// Too small to be a zone: a click, not a drag.
const MIN_SIZE = 0.015;

// Two corners of a drag (any order) → a zone, or null if it was just a click.
export function zoneFrom(a, b) {
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const zone = {
    x1: clamp(Math.min(a.x, b.x)),
    y1: clamp(Math.min(a.y, b.y)),
    x2: clamp(Math.max(a.x, b.x)),
    y2: clamp(Math.max(a.y, b.y)),
  };
  return zone.x2 - zone.x1 < MIN_SIZE || zone.y2 - zone.y1 < MIN_SIZE ? null : zone;
}

// A mark in zone coordinates → the same mark in display coordinates.
export function fromZone(mark, zone) {
  if (!zone) return mark;
  const w = zone.x2 - zone.x1;
  const h = zone.y2 - zone.y1;
  return {
    ...mark,
    x: zone.x1 + mark.x * w,
    y: zone.y1 + mark.y * h,
    ...(mark.w != null ? { w: mark.w * w } : {}),
    ...(mark.h != null ? { h: mark.h * h } : {}),
    ...(mark.points ? { points: mark.points.map(([x, y]) => [zone.x1 + x * w, zone.y1 + y * h]) } : {}),
  };
}

// A display point (the mouse pointer) → zone coordinates, or null outside it.
export function toZone(point, zone) {
  if (!point || !zone) return point ?? null;
  const x = (point.x - zone.x1) / (zone.x2 - zone.x1);
  const y = (point.y - zone.y1) / (zone.y2 - zone.y1);
  return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y };
}

// The zone in pixels of an image of the whole display.
export function zonePixels(zone, size) {
  const x = Math.round(zone.x1 * size.width);
  const y = Math.round(zone.y1 * size.height);
  return {
    x,
    y,
    width: Math.max(1, Math.round(zone.x2 * size.width) - x),
    height: Math.max(1, Math.round(zone.y2 * size.height) - y),
  };
}

// ----- several zones: the first one stays, the next ones are added -----
export const MAX_ZONES = 4;

// The zones with one more, or the same list when it is full.
export const addZone = (zones, zone) => (zone && zones.length < MAX_ZONES ? [...zones, zone] : zones);

// The zones without the i-th (0-based).
export const removeZone = (zones, index) => zones.filter((_, i) => i !== index);

// The zone a drawing line belongs to: "zone n" (1-based), else the first one.
export const frameOf = (frames, n = 1) => frames?.[n - 1] ?? frames?.[0] ?? null;
