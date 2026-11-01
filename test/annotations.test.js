import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPixels } from '../src/core/annotations.js';

test('toPixels maps fractions to the display and keeps a minimum ring size', () => {
  const px = toPixels({ x: 0.5, y: 0.25, w: 0, h: 0 }, { width: 1920, height: 1080 });
  assert.equal(px.cx, 960);
  assert.equal(px.cy, 270);
  assert.ok(px.rx >= 14 && px.ry >= 14);

  const big = toPixels({ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, { width: 1000, height: 1000 });
  assert.equal(big.rx, 54);
});

test('toPixels converts the points of a free shape', () => {
  const px = toPixels({ x: 0.2, y: 0.3, w: 0.2, h: 0.4, points: [[0.1, 0.1], [0.3, 0.5]] }, { width: 1000, height: 500 });
  assert.deepEqual(px.points, [[100, 50], [300, 250]]);
});
