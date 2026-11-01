import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt, buildUserContent } from '../src/core/prompt.js';
import { extractAnnotations } from '../src/core/annotations.js';

test('the system prompt sets the language and documents the judith block', () => {
  const prompt = buildSystemPrompt({ language: 'fr' });
  assert.match(prompt, /You speak French/);
  assert.match(prompt, /```judith/);
});

test('the example block in the prompt is valid for the parser', () => {
  const example = buildSystemPrompt().match(/```judith[\s\S]*?```/)[0];
  assert.equal(extractAnnotations(example).marks.length, 1);
});

test('user content puts the image first, then the context and the question', () => {
  const content = buildUserContent({
    question: 'Où est Exporter ?',
    image: { mediaType: 'image/jpeg', data: 'AAAA' },
    activeWindow: 'CapCut',
  });
  assert.equal(content[0].type, 'image');
  assert.equal(content[0].source.media_type, 'image/jpeg');
  assert.equal(content[1].text, 'Active window: CapCut\nOù est Exporter ?');
});

test('user content works without an image', () => {
  assert.deepEqual(buildUserContent({ question: 'Salut' }), [{ type: 'text', text: 'Salut' }]);
});
