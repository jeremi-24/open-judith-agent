// Judith answers in plain text followed by a fenced ```judith block that says
// where to draw. Coordinates are fractions (0..1) of the screenshot, so they do
// not depend on how the image was resized on the way to the model.

const BLOCK = /```judith\s*([\s\S]*?)```/i;
const MIN_RADIUS = 22;

const clamp01 = (n) => Math.min(1, Math.max(0, n));
const isNumber = (n) => typeof n === 'number' && Number.isFinite(n);

export function extractAnnotations(answer) {
  const match = String(answer ?? '').match(BLOCK);
  const text = String(answer ?? '').replace(BLOCK, '').trim();
  if (!match) return { text, steps: [], marks: [] };

  let data;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return { text, steps: [], marks: [] };
  }

  const steps = Array.isArray(data.steps) ? data.steps.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()) : [];
  const marks = (Array.isArray(data.marks) ? data.marks : [])
    .filter((m) => m && isNumber(m.x) && isNumber(m.y))
    .map((m, i) => ({
      step: Number.isInteger(m.step) && m.step > 0 ? m.step : i + 1,
      x: clamp01(m.x),
      y: clamp01(m.y),
      w: isNumber(m.w) ? clamp01(m.w) : null,
      h: isNumber(m.h) ? clamp01(m.h) : null,
      label: typeof m.label === 'string' ? m.label.trim() : '',
    }));

  return { text, steps, marks };
}

// Removes a ```judith block that is still being streamed, so the bubble never
// shows raw JSON while the answer arrives.
export function visibleText(partial) {
  const start = String(partial ?? '').search(/```judith/i);
  return (start >= 0 ? partial.slice(0, start) : String(partial ?? '')).trim();
}

// Converts a mark to pixels inside a display of the given size.
export function toPixels(mark, size) {
  const cx = Math.round(mark.x * size.width);
  const cy = Math.round(mark.y * size.height);
  const rx = Math.max(MIN_RADIUS, Math.round(((mark.w ?? 0) * size.width) / 2) + 10);
  const ry = Math.max(MIN_RADIUS, Math.round(((mark.h ?? 0) * size.height) / 2) + 10);
  return { ...mark, cx, cy, rx, ry };
}
