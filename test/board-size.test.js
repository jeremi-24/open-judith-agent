import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_MAX_WIDTH, BOARD_MIN_WIDTH, fitBoard, widerWidth, widthForFrame } from '../src/core/board-size.js';
import { FIT } from '../src/main/frames.js';

const SCREEN = { width: 1280, height: 720 };

test('the board takes the size it asks for, within the screen', () => {
  assert.deepEqual(fitBoard({ width: 560, height: 400 }, SCREEN), { width: 560, height: 400 });
  assert.deepEqual(fitBoard({ width: 9999, height: 9999 }, SCREEN), { width: BOARD_MAX_WIDTH, height: 688 });
  assert.deepEqual(fitBoard({}, SCREEN), { width: BOARD_MIN_WIDTH, height: 80 });
});

test('a small screen caps the width as well, never below the minimum', () => {
  assert.equal(fitBoard({ width: 700 }, { width: 600, height: 700 }).width, 568);
  assert.equal(fitBoard({ width: 700 }, { width: 300, height: 700 }).width, BOARD_MIN_WIDTH);
});

test('too tall for the screen: wider first, by steps, then it stops', () => {
  assert.equal(widerWidth(340, 1200), 460);
  assert.equal(widerWidth(700, 1200), BOARD_MAX_WIDTH);
  assert.equal(widerWidth(BOARD_MAX_WIDTH, 1200), null);
  assert.equal(widerWidth(500, 520), 520, 'the screen caps it too');
  assert.equal(widerWidth(520, 520), null);
});

test('a frame of a given width asks for its width plus the board around it', () => {
  assert.equal(widthForFrame(500), 556);
});

test('visual frames report their width as well as their height', () => {
  assert.match(FIT, /judithHeight/);
  assert.match(FIT, /judithWidth: document\.documentElement\.scrollWidth/);
});
