import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHANGED, markRect, regionDiff } from '../src/core/pixels.js';

const image = (width, height, fill) => {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const [b, g, r] = fill(i % width, Math.floor(i / width));
    data.set([b, g, r, 255], i * 4);
  }
  return { data, width, height };
};

test('same region, no difference; changed region, big difference', () => {
  const white = image(40, 20, () => [255, 255, 255]);
  const leftDark = image(40, 20, (x) => (x < 20 ? [0, 0, 0] : [255, 255, 255]));
  assert.equal(regionDiff(white, white, { x1: 0, y1: 0, x2: 1, y2: 1 }), 0);
  assert.ok(regionDiff(white, leftDark, { x1: 0, y1: 0, x2: 0.4, y2: 1 }) > CHANGED);
  // The right half did not change.
  assert.equal(regionDiff(white, leftDark, { x1: 0.6, y1: 0, x2: 1, y2: 1 }), 0);
});

test('different sizes count as changed', () => {
  assert.equal(regionDiff(image(4, 4, () => [0, 0, 0]), image(8, 4, () => [0, 0, 0]), { x1: 0, y1: 0, x2: 1, y2: 1 }), 255);
});

test('markRect adds a margin and stays inside the screen', () => {
  const r = markRect({ x: 0.5, y: 0.5, w: 0.2, h: 0.1 });
  assert.ok(Math.abs(r.x1 - 0.39) < 1e-9 && Math.abs(r.x2 - 0.61) < 1e-9);
  const edge = markRect({ x: 0, y: 1, w: 0, h: 0 });
  assert.equal(edge.x1, 0);
  assert.equal(edge.y2, 1);
});

test("excluded areas (Judith's own windows) are ignored", () => {
  const white = image(40, 20, () => [255, 255, 255]);
  const leftDark = image(40, 20, (x) => (x < 20 ? [0, 0, 0] : [255, 255, 255]));
  const all = { x1: 0, y1: 0, x2: 1, y2: 1 };
  assert.ok(regionDiff(white, leftDark, all) > CHANGED);
  assert.equal(regionDiff(white, leftDark, all, [{ x1: 0, y1: 0, x2: 0.5, y2: 1 }]), 0);
});

test('a tint change or a one-pixel jitter is not a change; a scroll is', () => {
  const text = (shift, tint) => image(60, 30, (x, y) => {
    const on = (x + shift) % 6 < 2 && y % 5 < 2; // a pattern of "letters"
    const v = on ? 40 : 230;
    return [v - tint, v - tint, v - tint];
  });
  const all = { x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.9 };
  assert.ok(regionDiff(text(0, 0), text(0, 25), all) < CHANGED, 'tint');
  assert.ok(regionDiff(text(0, 0), text(1, 0), all) < CHANGED, 'jitter');
  assert.ok(regionDiff(text(0, 0), text(3, 0), all) > CHANGED, 'scroll');
});
