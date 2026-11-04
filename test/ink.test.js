import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handStroke, inkFor, outlinePoints } from '../src/core/ink.js';
import { averageLuma } from '../src/core/pixels.js';

const ellipse = { shape: 'ring', cx: 200, cy: 100, rx: 60, ry: 30 };

test('the same mark always gets the same hand-drawn stroke', () => {
  const pts = outlinePoints(ellipse);
  assert.equal(handStroke(pts, 7).d, handStroke(pts, 7).d);
  assert.notEqual(handStroke(pts, 7).d, handStroke(pts, 8).d);
});

test('the hand drifts, but stays close to the outline', () => {
  const pts = outlinePoints(ellipse);
  const { points } = handStroke(pts, 3, { wobble: 2.5 });
  for (const [x, y] of points) {
    // Distance to the ideal ellipse, roughly: |(x/rx)² + (y/ry)² - 1| small.
    const v = ((x - 200) / 60) ** 2 + ((y - 100) / 30) ** 2;
    assert.ok(Math.abs(v - 1) < 0.35, `point ${x},${y} too far`);
  }
  // It runs past its start: more points than the outline.
  assert.ok(points.length > pts.length);
});

test('boxes and free shapes give closed outlines too', () => {
  const box = outlinePoints({ shape: 'box', cx: 50, cy: 50, rx: 40, ry: 20 });
  assert.equal(box.length, 56);
  for (const [x, y] of box) assert.ok(x >= 9 && x <= 91 && y >= 29 && y <= 71);
  const free = outlinePoints({ shape: 'shape', points: [[0, 0], [100, 0], [100, 50]] }, 30);
  assert.equal(free.length, 30);
});

test('dark ink on light backgrounds, light ink on dark ones', () => {
  assert.equal(inkFor(230), 'dark');
  assert.equal(inkFor(40), 'light');
  const white = { width: 4, height: 4, data: new Uint8Array(64).fill(255) };
  const black = { width: 4, height: 4, data: new Uint8Array(64).fill(0) };
  const all = { x1: 0, y1: 0, x2: 1, y2: 1 };
  assert.ok(averageLuma(white, all) > 250);
  assert.equal(averageLuma(black, all), 0);
});

test('an arrow ends exactly on its target, with a head pointing at it', async () => {
  const { arrowStroke } = await import('../src/core/ink.js');
  const a = arrowStroke([100, 100], [400, 300], 7);
  const last = a.points.at(-1);
  assert.ok(Math.hypot(last[0] - 400, last[1] - 300) < 0.5);
  assert.match(a.head, /^M[\d.]+ [\d.]+ L400 300 L[\d.]+ [\d.]+$/);
  // Hand-drawn: bent, not a straight line, and the same seed draws the same arrow.
  const middle = a.points[8];
  const offLine = Math.abs((300 - 100) * middle[0] - (400 - 100) * middle[1] + 400 * 100 - 300 * 100) / Math.hypot(200, 300);
  assert.ok(offLine > 3);
  assert.equal(arrowStroke([100, 100], [400, 300], 7).d, a.d);
});
