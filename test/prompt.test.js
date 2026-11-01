import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt, buildUserContent, describeApproval, describeTool } from '../src/core/prompt.js';
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

test('Judith decides by herself between showing and doing', () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /TALK, SHOW, EXPLAIN or DO/);
  assert.match(prompt, /mcp__judith__open_app/);
});

test('tool calls are described in plain words', () => {
  assert.equal(describeTool('mcp__judith__open_app', { name: 'VLC' }), "J'ouvre VLC");
  assert.equal(describeTool('Edit', { file_path: 'C:\\code\\src\\bases.ts' }), 'Je modifie bases.ts');
  assert.equal(describeTool('Bash', { command: 'npm test' }, 'en'), 'Running npm test');
  assert.deepEqual(describeApproval('Bash', { command: 'npm test' }), { title: 'Je lance npm test', detail: 'npm test' });
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
