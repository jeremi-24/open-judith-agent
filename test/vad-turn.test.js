import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVad } from '../src/core/vad.js';
import { isGoodbye, isIncomplete } from '../src/core/turn.js';

// Feeds a sequence of [level, durationMs] and returns the events.
function run(vad, steps, frameMs = 64) {
  const events = [];
  for (const [level, ms] of steps) {
    for (let t = 0; t < ms; t += frameMs) {
      const e = vad.push(level, frameMs);
      if (e) events.push(e);
    }
  }
  return events;
}

test('a sentence in a quiet room: start, then end after the silence', () => {
  const vad = createVad();
  assert.deepEqual(run(vad, [[0.005, 600], [0.1, 1500], [0.005, 1200]]), ['start', 'end']);
});

test('a pause shorter than the end delay does not cut the sentence', () => {
  const vad = createVad({ endMs: 900 });
  assert.deepEqual(run(vad, [[0.005, 500], [0.1, 800], [0.005, 500], [0.1, 800], [0.005, 1200]]), ['start', 'end']);
});

test('a click or a cough is noise, not speech', () => {
  const vad = createVad({ minSpeechMs: 300 });
  assert.deepEqual(run(vad, [[0.005, 500], [0.2, 192], [0.005, 1200]]), ['start', 'noise']);
});

test('in a noisy room the threshold rises with the floor', () => {
  const vad = createVad();
  run(vad, [[0.03, 2000]]);
  assert.ok(vad.threshold > 0.08);
  // The room noise alone never starts speech…
  assert.deepEqual(run(vad, [[0.03, 2000]]), []);
  // …a voice above it does.
  assert.deepEqual(run(vad, [[0.2, 1000], [0.03, 1200]]), ['start', 'end']);
});

test('an unfinished sentence waits for the rest', () => {
  for (const t of ['Ouvre VLC et', 'Montre-moi le bouton pour', 'Euh', 'Je voudrais, euh', 'parce que', "Tu peux ouvrir l'", 'Attends,', 'and']) {
    assert.ok(isIncomplete(t), t);
  }
  for (const t of ['Ouvre VLC.', 'Où est le bouton Exporter ?', 'Ouvre VLC', 'Merci Judith', '']) {
    assert.ok(!isIncomplete(t), t);
  }
});

test('a goodbye ends the conversation, a request does not', () => {
  for (const bye of ['Arrête.', 'Allez, salut.', 'Bonsoir. Bonsoir.', "Merci, c'est bon.", 'Stop', "C'est tout pour aujourd'hui", 'À plus Judith !', 'Ça suffit, merci.', "Non, c'est bon, j'ai fini."]) {
    assert.ok(isGoodbye(bye), bye);
  }
  for (const ask of ['Arrête de regarder en boucle.', 'Ok merci.', "Explique-moi ça", "C'est quoi ça ?", 'Salut Judith, ouvre VLC', 'Non, je veux dire éteins l\'écoute en temps réel']) {
    assert.ok(!isGoodbye(ask), ask);
  }
});
