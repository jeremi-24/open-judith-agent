import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractAnnotations, toPixels, visibleText } from '../src/core/annotations.js';

const answer = `Ouvre **VLC**, puis va dans **Média › Convertir**.
\`\`\`judith
{"steps": ["Ouvre VLC", "Média › Convertir"], "marks": [{"step": 1, "x": 0.11, "y": 0.33, "label": "Double-clique ici"}]}
\`\`\``;

test('extracts the text, the steps and the marks', () => {
  const { text, steps, marks } = extractAnnotations(answer);
  assert.equal(text, 'Ouvre **VLC**, puis va dans **Média › Convertir**.');
  assert.deepEqual(steps, ['Ouvre VLC', 'Média › Convertir']);
  assert.equal(marks.length, 1);
  assert.deepEqual(marks[0], { step: 1, x: 0.11, y: 0.33, w: null, h: null, label: 'Double-clique ici' });
});

test('an answer without a block has no marks', () => {
  assert.deepEqual(extractAnnotations('Bonjour !'), { text: 'Bonjour !', steps: [], marks: [] });
});

test('broken JSON is ignored instead of crashing', () => {
  const { text, marks } = extractAnnotations('Voilà.\n```judith\n{"marks": [oops]}\n```');
  assert.equal(text, 'Voilà.');
  assert.deepEqual(marks, []);
});

test('coordinates are clamped and invalid marks dropped', () => {
  const { marks } = extractAnnotations('```judith\n{"marks": [{"x": 1.4, "y": -0.2}, {"x": "a", "y": 0.5}]}\n```');
  assert.equal(marks.length, 1);
  assert.equal(marks[0].x, 1);
  assert.equal(marks[0].y, 0);
  assert.equal(marks[0].step, 1);
});

test('visibleText hides a block that is still streaming', () => {
  assert.equal(visibleText('Clique ici.\n```judith\n{"steps": ["Ouv'), 'Clique ici.');
  assert.equal(visibleText('Pas de bloc'), 'Pas de bloc');
});

test('toPixels maps fractions to the display and keeps a minimum ring size', () => {
  const px = toPixels({ x: 0.5, y: 0.25, w: null, h: null }, { width: 1920, height: 1080 });
  assert.equal(px.cx, 960);
  assert.equal(px.cy, 270);
  assert.ok(px.rx >= 22 && px.ry >= 22);

  const big = toPixels({ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, { width: 1000, height: 1000 });
  assert.equal(big.rx, 60);
});
