import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGhost } from '../src/core/hallucinations.js';

test('typical Whisper phantoms are ignored', () => {
  for (const t of ['Merci.', 'Merci beaucoup !', 'Sous-titres réalisés par la communauté', '...', 'Ok.', '', '  ']) {
    assert.ok(isGhost(t), t);
  }
});

test('real questions go through', () => {
  for (const t of ['Merci, et maintenant ouvre VLC', 'Où est le bouton Exporter ?', 'Oui, fais-le']) {
    assert.ok(!isGhost(t), t);
  }
});

test('Judith hearing herself is an echo, a new question is not', async () => {
  const { isEcho } = await import('../src/core/hallucinations.js');
  const spoken = "Salut, je suis Judith, ravie de t'accompagner aujourd'hui.";
  assert.ok(isEcho('je suis Judith ravie de t accompagner', spoken));
  assert.ok(!isEcho('Ouvre VLC et montre-moi le bouton exporter', spoken));
  assert.ok(!isEcho('Bonjour', ''));
});
