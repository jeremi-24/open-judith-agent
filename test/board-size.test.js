import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_MAX_WIDTH, BOARD_MIN_HEIGHT, BOARD_MIN_WIDTH, fitBoard, maxBoardHeight, maxBoardWidth, widerWidth, widthForFrame } from '../src/core/board-size.js';
import { FIT } from '../src/main/frames.js';

const SCREEN = { width: 1280, height: 720 };

test('the board takes the size it asks for, up to its share of the screen', () => {
  assert.deepEqual(fitBoard({ width: 480, height: 400 }, SCREEN), { width: 480, height: 400 });
  assert.deepEqual(fitBoard({ width: 9999, height: 9999 }, SCREEN), { width: 537, height: 446 });
  assert.deepEqual(fitBoard({}, SCREEN), { width: BOARD_MIN_WIDTH, height: BOARD_MIN_HEIGHT });
});

test('the board never covers more than its share: under half the width, under two thirds of the height', () => {
  for (const area of [SCREEN, { width: 1536, height: 824 }, { width: 2560, height: 1400 }]) {
    const { width, height } = fitBoard({ width: 9999, height: 9999 }, area);
    assert.ok(width <= area.width * 0.42 && width <= BOARD_MAX_WIDTH, `width ${width} on ${area.width}`);
    assert.ok(height <= area.height * 0.62, `height ${height} on ${area.height}`);
  }
  assert.equal(maxBoardWidth(2560), BOARD_MAX_WIDTH, 'a big screen does not make a huge board');
  assert.equal(maxBoardHeight(720), 446);
});

test('a small screen caps the width as well, never below the minimum', () => {
  assert.equal(fitBoard({ width: 700 }, { width: 1000, height: 700 }).width, 420);
  assert.equal(fitBoard({ width: 700 }, { width: 300, height: 700 }).width, BOARD_MIN_WIDTH);
});

test('too tall for the screen: wider first, by steps, then it stops', () => {
  assert.equal(widerWidth(320, 1200), 440);
  assert.equal(widerWidth(600, 1200), BOARD_MAX_WIDTH);
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
