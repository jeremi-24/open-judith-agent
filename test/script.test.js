import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScriptReader, parseLine } from '../src/core/script.js';

test('say, ring, box and their labels', () => {
  assert.deepEqual(parseLine('say Clique ici.'), { type: 'say', text: 'Clique ici.' });
  // Corners: left top right bottom.
  const m = parseLine('ring 0.4 0.2 0.6 0.3 | Exporter');
  assert.equal(m.shape, 'ring');
  assert.equal(m.label, 'Exporter');
  assert.ok(Math.abs(m.x - 0.5) < 1e-9 && Math.abs(m.y - 0.25) < 1e-9);
  assert.ok(Math.abs(m.w - 0.2) < 1e-9 && Math.abs(m.h - 0.1) < 1e-9);
  // Swapped corners are fixed, a single point works, other counts are refused.
  assert.ok(Math.abs(parseLine('box 0.6 0.3 0.4 0.2').x - 0.5) < 1e-9);
  assert.equal(parseLine('box 0.2 0.3').w, 0);
  assert.equal(parseLine('ring 0.1 0.2 0.3'), null);
  assert.equal(parseLine('ring 1.4 -0.2').x, 1);
});

test('a free shape gets its center and size from its points', () => {
  const m = parseLine('shape 0.1 0.1, 0.3 0.1, 0.3 0.5 | Aile');
  assert.equal(m.shape, 'shape');
  assert.deepEqual(m.points, [[0.1, 0.1], [0.3, 0.1], [0.3, 0.5]]);
  assert.ok(Math.abs(m.x - 0.2) < 1e-9 && Math.abs(m.y - 0.3) < 1e-9);
  assert.equal(m.label, 'Aile');
  assert.equal(parseLine('shape 0.1 0.2 0.3'), null);
});

test('board, note, step and clear', () => {
  assert.deepEqual(parseLine('board Le guêpier | Une vie dans les airs'), { type: 'board', title: 'Le guêpier', subtitle: 'Une vie dans les airs' });
  assert.deepEqual(parseLine('note Insectes en vol'), { type: 'note', text: 'Insectes en vol' });
  assert.deepEqual(parseLine('step Ouvre VLC'), { type: 'step', text: 'Ouvre VLC' });
  assert.deepEqual(parseLine('clear'), { type: 'clear' });
});

test('plain lines are spoken; fences, bullets and blanks are ignored', () => {
  assert.deepEqual(parseLine('Salut !'), { type: 'say', text: 'Salut !' });
  assert.deepEqual(parseLine('- say Bonjour'), { type: 'say', text: 'Bonjour' });
  assert.equal(parseLine('```judith'), null);
  assert.equal(parseLine('   '), null);
  assert.deepEqual(parseLine('ring is a word'), null);
});

test('the reader emits each line once, as soon as it is complete', () => {
  const seen = [];
  const reader = createScriptReader((c) => seen.push(c.type));
  reader.push('say Un.\nring 0.1 0.1 0.2');
  assert.deepEqual(seen, ['say']);
  reader.push('say Un.\nring 0.1 0.1 0.2 0.2\nsay De');
  assert.deepEqual(seen, ['say', 'mark']);
  reader.finish('say Un.\nring 0.1 0.1 0.2 0.2\nsay Deux.');
  assert.deepEqual(seen, ['say', 'mark', 'say']);
});

test('an arrow joins two points, its label is optional', () => {
  const arrow = parseLine('arrow 0.1 0.2 0.5 0.6 | vient de là');
  assert.equal(arrow.shape, 'arrow');
  assert.deepEqual(arrow.points, [[0.1, 0.2], [0.5, 0.6]]);
  assert.equal(arrow.label, 'vient de là');
  assert.ok(Math.abs(arrow.x - 0.3) < 1e-9 && Math.abs(arrow.y - 0.4) < 1e-9);
  assert.equal(parseLine('arrow 0.1 0.2 0.5 0.6').label, '');
  assert.equal(parseLine('arrow 0.1 0.2 0.1 0.2'), null);
  assert.equal(parseLine('arrow 0.1 0.2 0.5'), null);
});

test('scene <n> moves the 3D scene; anything else after "scene" is spoken', () => {
  assert.deepEqual(parseLine('scene 2'), { type: 'scene', step: 2 });
  assert.equal(parseLine('scene 0').type, 'say');
  assert.equal(parseLine('scene du crime').type, 'say');
});
