import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLinks, isCreation, speakable } from '../src/core/links.js';
import { fromZone, toZone, zoneFrom, zonePixels } from '../src/core/zone.js';

const ANSWER = 'Document de test créé : [Document de test](https://claude.ai/artifact/K77JhqN9zisbQS4MizgoU1). Tu peux le lire.';

test('a markdown link becomes its title for the voice', () => {
  assert.equal(speakable(ANSWER), 'Document de test créé : Document de test. Tu peux le lire.');
  assert.equal(speakable('Va sur https://github.com/jeremi-24.'), 'Va sur le lien.');
});

test('links are found once, creations recognised', () => {
  const links = findLinks(`${ANSWER} Encore : https://claude.ai/artifact/K77JhqN9zisbQS4MizgoU1. Et https://www.github.com/x`);
  assert.deepEqual(links.map((l) => [l.title, l.creation]), [['Document de test', true], ['github.com', false]]);
  assert.ok(isCreation('https://claude.ai/code/artifact/0b8c'));
  assert.ok(!isCreation('https://claude.ai/chat/0b8c'));
});

test('a drag becomes a zone, a click does not', () => {
  assert.deepEqual(zoneFrom({ x: 0.6, y: 0.5 }, { x: 0.2, y: 0.1 }), { x1: 0.2, y1: 0.1, x2: 0.6, y2: 0.5 });
  assert.equal(zoneFrom({ x: 0.2, y: 0.2 }, { x: 0.205, y: 0.4 }), null);
});

test('marks and pointer go between zone and display coordinates', () => {
  const zone = { x1: 0.5, y1: 0.2, x2: 1, y2: 0.6 };
  const mark = fromZone({ type: 'mark', x: 0.5, y: 0.5, w: 0.2, h: 0.5, points: [[0, 1]] }, zone);
  assert.deepEqual([mark.x, mark.y, mark.w, mark.h].map((v) => +v.toFixed(6)), [0.75, 0.4, 0.1, 0.2]);
  assert.deepEqual(mark.points, [[0.5, 0.6]]);
  const inside = toZone({ x: 0.75, y: 0.4 }, zone);
  assert.deepEqual([inside.x, inside.y].map((v) => +v.toFixed(6)), [0.5, 0.5]);
  assert.equal(toZone({ x: 0.1, y: 0.4 }, zone), null);
  assert.deepEqual(zonePixels(zone, { width: 1920, height: 1080 }), { x: 960, y: 216, width: 960, height: 432 });
});
