import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt, buildUserContent, describeApproval, describeTool } from '../src/core/prompt.js';
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

test('Judith decides by herself between showing and doing', () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /SHOW or to DO/);
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
