import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt, buildUserContent, describeTool } from '../src/core/prompt.js';
import { parseLine } from '../src/core/script.js';

test('the system prompt sets the language and documents the script', () => {
  const prompt = buildSystemPrompt({ language: 'fr' });
  assert.match(prompt, /You speak French/);
  assert.match(prompt, /ANSWER FORMAT/);
  assert.match(prompt, /mcp__judith__show_visual/);
});

test('the example in the prompt is valid script', () => {
  const [, first, comparison] = buildSystemPrompt().split(/Example.*:\n/);
  const types = (text) => text.trim().split('\n').map(parseLine).map((c) => c.type);
  // Drawing first, then the sentence about it.
  assert.deepEqual(types(first), ['mark', 'step', 'say', 'step', 'say']);
  // A comparison: one mark per compared item.
  assert.deepEqual(types(comparison), ['mark', 'say', 'mark', 'say', 'mark', 'say']);
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

test('Judith talks, shows and explains, but never acts on the computer', () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /TALK, SHOW or EXPLAIN/);
  assert.match(prompt, /You never act on the computer/);
  assert.match(prompt, /Take your examples from the screen itself/);
  for (const tool of ['open_app', 'open_url', 'open_path', 'copy_screenshot', 'set_reminder']) {
    assert.doesNotMatch(prompt, new RegExp(tool));
  }
});

test('tool calls are described in plain words', () => {
  assert.equal(describeTool('mcp__judith__look_at_screen', {}), 'Je regarde ton écran');
  assert.equal(describeTool('Read', { file_path: 'C:\\code\\src\\bases.ts' }), 'Je lis bases.ts');
  assert.equal(describeTool('WebSearch', { query: 'turbofan' }, 'en'), 'Searching "turbofan"');
});

test('user content works without an image', () => {
  assert.deepEqual(buildUserContent({ question: 'Salut' }), [{ type: 'text', text: 'Salut' }]);
});

test('the annotation mode changes the drawing rule', () => {
  assert.match(buildSystemPrompt({ annotations: 'none' }), /Never draw on the screen/);
  assert.match(buildSystemPrompt(), /Draw on the screen ONLY when it saves the user from searching/);
  assert.match(buildSystemPrompt({ annotations: 'always' }), /mark the elements you talk about/);
  assert.match(buildSystemPrompt({ annotations: 'oops' }), /ONLY when/);
});

test('"ça" is what is under the mouse pointer', async () => {
  const { pointerNote } = await import('../src/core/prompt.js');
  const [text] = buildUserContent({ question: "C'est quoi ça ?", pointer: { x: 0.4, y: 0.25 } });
  assert.match(text.text, /Mouse pointer: x=0\.400 y=0\.250/);
  assert.match(text.text, /C'est quoi ça \?$/);
  assert.equal(pointerNote(null), '');
});

test('the notes board is only offered when it is turned on', () => {
  assert.doesNotMatch(buildSystemPrompt(), /^board </m);
  assert.match(buildSystemPrompt({ board: true }), /^board </m);
  assert.match(buildSystemPrompt(), /annotate the real thing, never redraw it/);
});

test('a zone screenshot says it is only a zone', () => {
  const content = buildUserContent({ question: "C'est quoi ?", image: { mediaType: 'image/jpeg', data: 'AAAA' }, zone: true });
  assert.match(content[1].text, /zone of the screen the user selected/);
  assert.doesNotMatch(buildUserContent({ question: 'Salut' })[0].text, /zone/);
});
