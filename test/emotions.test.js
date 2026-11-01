import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripEmotions } from '../src/core/emotions.js';
import { buildSystemPrompt } from '../src/core/prompt.js';

test('emotion tags are removed for display and other voices', () => {
  assert.equal(
    stripEmotions('[excited] Bravo, ça marche ! [break] Maintenant, clique sur **Exporter**.'),
    'Bravo, ça marche ! Maintenant, clique sur **Exporter**.',
  );
  assert.equal(stripEmotions('Sans balise.'), 'Sans balise.');
  assert.equal(stripEmotions('Un tableau [1, 2] reste. [whispering] Un secret'), 'Un tableau [1, 2] reste. Un secret');
});

test('the emotion rule is only in the prompt when the voice can act', () => {
  assert.doesNotMatch(buildSystemPrompt(), /\[whispering\]/);
  assert.match(buildSystemPrompt({ emotions: true }), /\[whispering\]/);
});
