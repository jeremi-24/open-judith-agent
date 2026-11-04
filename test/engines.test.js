import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseEngine } from '../src/engine/engines.js';
import { ApiEngine, buildRequest, createSSEParser, deltaOf, toOpenAIContent } from '../src/engine/api.js';
import { buildCliPrompt, instructionFor, parseCodexLine, parseCursorLine, quoteForShell, safeModel } from '../src/engine/cli-agent.js';

const IMAGE = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } };
const ask = (text, image = false) => [...(image ? [IMAGE] : []), { type: 'text', text }];

// ----- choosing the engine -----

test('auto picks Claude Code, then Codex, then Cursor, then an API key', () => {
  assert.equal(chooseEngine({ configured: 'auto', available: ['codex', 'claude-code'] }), 'claude-code');
  assert.equal(chooseEngine({ configured: 'auto', available: ['cursor', 'codex'] }), 'codex');
  assert.equal(chooseEngine({ configured: 'auto', available: [], hasKey: true }), 'api');
  assert.equal(chooseEngine({ configured: 'auto', available: [] }), 'claude-code');
});

test('a configured engine wins when it is usable, else auto takes over', () => {
  assert.equal(chooseEngine({ configured: 'cursor', available: ['claude-code', 'cursor'] }), 'cursor');
  assert.equal(chooseEngine({ configured: 'codex', available: ['claude-code'] }), 'claude-code');
  assert.equal(chooseEngine({ configured: 'api', available: ['claude-code'], hasKey: true }), 'api');
  assert.equal(chooseEngine({ configured: 'api', available: ['claude-code'], hasKey: false }), 'claude-code');
});

// ----- API engine: requests -----

test('Anthropic request: messages API, key header, image kept as is', () => {
  const r = buildRequest({ provider: 'anthropic', key: 'k', system: 'S', content: ask('Hi', true), history: [{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }] });
  assert.equal(r.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(r.headers['x-api-key'], 'k');
  assert.equal(r.body.system, 'S');
  assert.equal(r.body.stream, true);
  assert.equal(r.body.model, 'claude-haiku-5-5');
  assert.deepEqual(r.body.messages.slice(0, 2), [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]);
  assert.equal(r.body.messages[2].content[0].type, 'image');
});

test('OpenAI-compatible request: bearer key, system message, image as a data URL', () => {
  const r = buildRequest({ provider: 'gemini', key: 'k', model: 'gemini-x', system: 'S', content: ask('Hi', true) });
  assert.equal(r.url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  assert.equal(r.headers.authorization, 'Bearer k');
  assert.equal(r.body.model, 'gemini-x');
  assert.deepEqual(r.body.messages[0], { role: 'system', content: 'S' });
  assert.deepEqual(r.body.messages[1].content[0], { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } });
});

test('a custom base URL (Ollama…) and a provider without default model', () => {
  const r = buildRequest({ provider: 'openai', key: 'k', baseUrl: 'http://localhost:11434/v1/', model: 'llava', system: '', content: ask('x') });
  assert.equal(r.url, 'http://localhost:11434/v1/chat/completions');
  assert.throws(() => buildRequest({ provider: 'openrouter', key: 'k', system: '', content: ask('x') }), /Choose a model/);
  assert.throws(() => buildRequest({ provider: 'nope', key: 'k', system: '', content: ask('x') }), /Unknown provider/);
});

test('toOpenAIContent keeps the order of text and images', () => {
  assert.deepEqual(toOpenAIContent(ask('Q', true)).map((b) => b.type), ['image_url', 'text']);
});

// ----- API engine: streaming -----

test('stream events: text deltas for both protocols, errors thrown', () => {
  assert.equal(deltaOf('anthropic', { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Bon' } }), 'Bon');
  assert.equal(deltaOf('anthropic', { type: 'message_start' }), '');
  assert.throws(() => deltaOf('anthropic', { type: 'error', error: { message: 'overloaded' } }), /overloaded/);
  assert.equal(deltaOf('openai', { choices: [{ delta: { content: 'jour' } }] }), 'jour');
  assert.equal(deltaOf('openai', { choices: [{ delta: {} }] }), '');
  assert.throws(() => deltaOf('openai', { error: { message: 'bad key' } }), /bad key/);
});

test('the SSE parser handles lines split across chunks and [DONE]', () => {
  const events = [];
  const parse = createSSEParser((e) => events.push(e));
  parse('data: {"a":');
  parse('1}\n\ndata: [DONE]\n');
  parse('event: ping\ndata: {"b":2}\n');
  assert.deepEqual(events, [{ a: 1 }, { b: 2 }]);
});

// A fake fetch that streams the given SSE chunks.
function fakeFetch(chunks, { status = 200, onCall } = {}) {
  return async (url, init) => {
    onCall?.(url, init);
    if (init.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const encoder = new TextEncoder();
    return {
      ok: status === 200,
      status,
      text: async () => 'nope',
      body: (async function* () {
        for (const chunk of chunks) {
          if (init.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
          await new Promise((r) => setTimeout(r, 1));
          yield encoder.encode(chunk);
        }
      })(),
    };
  };
}

test('ApiEngine streams the answer, then remembers the words of the turn', async () => {
  const sent = [];
  const engine = new ApiEngine({
    provider: 'openai',
    key: 'k',
    systemPrompt: 'S',
    fetchImpl: fakeFetch(['data: {"choices":[{"delta":{"content":"say Bon"}}]}\n', 'data: {"choices":[{"delta":{"content":"jour."}}]}\n'], { onCall: (_u, init) => sent.push(JSON.parse(init.body)) }),
  });
  const deltas = [];
  engine.on('delta', (t) => deltas.push(t));
  const result = await engine.ask(ask('Salut', true));
  assert.equal(result.text, 'say Bonjour.');
  assert.deepEqual(deltas, ['say Bon', 'say Bonjour.']);
  assert.deepEqual(engine.history, [{ role: 'user', text: 'Salut' }, { role: 'assistant', text: 'say Bonjour.' }]);
  await engine.ask(ask('Encore'));
  // The second request carries the first turn as text only (no old screenshot).
  assert.deepEqual(sent[1].messages[1], { role: 'user', content: 'Salut' });
});

test('ApiEngine: no key, an HTTP error, and cancel', async () => {
  await assert.rejects(new ApiEngine({ provider: 'anthropic', key: '', systemPrompt: '' }).ask(ask('x')), /No API key/);
  await assert.rejects(new ApiEngine({ provider: 'openai', key: 'k', systemPrompt: '', fetchImpl: fakeFetch([], { status: 401 }) }).ask(ask('x')), /OpenAI 401/);
  const slow = new ApiEngine({ provider: 'openai', key: 'k', systemPrompt: '', fetchImpl: fakeFetch(Array(50).fill('data: {"choices":[{"delta":{"content":"a"}}]}\n')) });
  const pending = slow.ask(ask('x'));
  setTimeout(() => slow.cancel(), 5);
  await assert.rejects(pending, (error) => error.cancelled === true);
  assert.equal(slow.busy, false);
});

// ----- CLI agents (Codex, Cursor) -----

test('Codex events: every known shape gives the answer', () => {
  assert.deepEqual(parseCodexLine({ type: 'item.completed', item: { type: 'agent_message', text: 'say ok' } }), { final: 'say ok' });
  assert.deepEqual(parseCodexLine({ method: 'item/completed', params: { item: { type: 'agentMessage', text: 'say ok' } } }), { final: 'say ok' });
  assert.deepEqual(parseCodexLine({ method: 'item/agentMessage/delta', params: { delta: 'say' } }), { delta: 'say' });
  assert.deepEqual(parseCodexLine({ msg: { type: 'agent_message', message: 'say ok' } }), { final: 'say ok' });
  assert.deepEqual(parseCodexLine({ type: 'turn.started' }), {});
  assert.throws(() => parseCodexLine({ type: 'turn.failed', error: { message: 'quota' } }), /quota/);
});

test('Cursor events: partial assistant text, then the result', () => {
  assert.deepEqual(parseCursorLine({ type: 'assistant', message: { content: [{ type: 'text', text: 'say B' }] } }), { delta: 'say B' });
  assert.deepEqual(parseCursorLine({ type: 'result', result: 'say Bonjour' }), { final: 'say Bonjour' });
  assert.deepEqual(parseCursorLine({ type: 'system' }), {});
  assert.throws(() => parseCursorLine({ type: 'result', is_error: true, result: 'not logged in' }), /not logged in/);
});

test('the CLI prompt holds the rules, the last turns, the question and the screenshot path', () => {
  const prompt = buildCliPrompt({ systemPrompt: 'RULES', history: [{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }], question: 'Q', image: 'C:\\tmp\\s.jpg' });
  assert.match(prompt, /^RULES/);
  assert.match(prompt, /User: a\nJudith: b/);
  assert.match(prompt, /User: Q\n\nThe user's screen is the image at: C:\\tmp\\s\.jpg$/);
});

test('nothing from the user or the screen reaches the command line', () => {
  // Only a fixed sentence and a file path.
  assert.equal(instructionFor('C:\\Temp\\judith-1.md'), 'Read the file C:\\Temp\\judith-1.md and do exactly what it says. Answer only in the format it describes.');
  // Model names are checked, so "& del" cannot slip in through the settings.
  assert.equal(safeModel('gpt-5.2-codex'), 'gpt-5.2-codex');
  assert.equal(safeModel(''), null);
  assert.throws(() => safeModel('gpt & del C:\\'), /Invalid model/);
  // Arguments with spaces are quoted; simple ones are left alone.
  assert.equal(quoteForShell('--sandbox'), '--sandbox');
  assert.equal(quoteForShell('C:\\Users\\Ama Doe\\Temp\\j.jpg'), '"C:\\Users\\Ama Doe\\Temp\\j.jpg"');
});

// A fake "codex" executable: it reads the prompt file named in its last
// argument (as the real agent would) and streams JSON events.
test('CliAgentEngine runs the agent, streams, and cleans up its temp files', { skip: process.platform === 'win32' }, async () => {
  const { mkdtempSync, writeFileSync, chmodSync, existsSync, readdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { CliAgentEngine } = await import('../src/engine/cli-agent.js');
  const dir = mkdtempSync(join(tmpdir(), 'judith-fake-'));
  const fake = join(dir, 'codex');
  writeFileSync(
    fake,
    `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const file = args.at(-1).match(/Read the file (\\S+)/)[1];
const prompt = fs.readFileSync(file, 'utf8');
const image = args[args.indexOf('--image') + 1];
console.log(JSON.stringify({ type: 'thread.started' }));
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'say ' + (prompt.includes('User: Q') ? 'vu' : 'rien') + (fs.existsSync(image) ? ' + image' : '') } }));
`,
  );
  chmodSync(fake, 0o755);
  const before = readdirSync(tmpdir()).filter((f) => f.startsWith('judith-') && !f.startsWith('judith-fake')).length;
  const engine = new CliAgentEngine({ agent: 'codex', command: fake, systemPrompt: 'RULES' });
  const result = await engine.ask(ask('Q', true));
  assert.equal(result.text, 'say vu + image');
  const after = readdirSync(tmpdir()).filter((f) => f.startsWith('judith-') && !f.startsWith('judith-fake')).length;
  assert.equal(after, before, 'the screenshot and prompt files are deleted');
  assert.equal(existsSync(fake), true);
});
