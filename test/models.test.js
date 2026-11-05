import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchModels } from '../src/engine/model-sources.js';
import { applyVerification, groupModels, groupOf, makeModel, nameHint, priceLabel, selectionStatus, shortTokens } from '../src/engine/models.js';
import { CACHE_TTL_MS, createModelsService } from '../src/main/models-service.js';

// Answers shaped like each provider's documentation (OpenRouter and NVIDIA: like their real, public answers).
const respond = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => (typeof body === 'string' ? JSON.parse(body) : body) });
const routes = (map) => async (url, init) => {
  const hit = Object.entries(map).find(([prefix]) => String(url).startsWith(prefix));
  if (!hit) throw new Error(`unexpected call ${url}`);
  const answer = typeof hit[1] === 'function' ? hit[1](url, init) : hit[1];
  if (answer instanceof Error) throw answer;
  return answer;
};

const OPENROUTER = {
  data: [
    { id: 'tencent/hy4', name: 'Tencent: Hy4', context_length: 1048576, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, pricing: { prompt: '0.000000417', completion: '0.0000012505' }, supported_parameters: ['tools', 'max_tokens'], top_provider: { max_completion_tokens: 65536 }, expiration_date: null },
    { id: 'vendor/text-only', name: 'Vendor: Text only', context_length: 32768, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['max_tokens'], expiration_date: null },
    { id: 'nvidia/some-embed', name: 'NVIDIA: Some Embed', architecture: { input_modalities: ['text'], output_modalities: ['embeddings'] }, expiration_date: null },
    { id: 'vendor/going-away', name: 'Vendor: Going away', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, expiration_date: '2020-01-01' },
    { name: 'no id at all' },
    'not an object',
  ],
  total_count: 6,
  links: { next: null },
};
const ANTHROPIC = { data: [{ type: 'model', id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5', capabilities: { image_input: { supported: true } }, lifecycle: 'active', line: 'haiku', max_input_tokens: 200000, max_tokens: 64000, retires_at: null }, { type: 'model', id: 'claude-old', display_name: 'Claude Old', capabilities: null, lifecycle: 'retired', retires_at: '2025-01-01' }], has_more: false, first_id: 'a', last_id: 'b' };
const MISTRAL = { object: 'list', data: [{ id: 'mistral-small-latest', object: 'model', capabilities: { completion_chat: true, completion_fim: false, function_calling: true, fine_tuning: false, vision: true, classification: false }, max_context_length: 131072, archived: false }, { id: 'mistral-embed', capabilities: { completion_chat: false, vision: false, classification: false }, max_context_length: 8192 }] };
const GEMINI = { models: [{ name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', inputTokenLimit: 1048576, outputTokenLimit: 65536, supportedGenerationMethods: ['generateContent', 'countTokens'] }, { name: 'models/text-embedding-004', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] }] };
const GROQ = { object: 'list', data: [{ id: 'meta-llama/llama-4-scout-17b-16e-instruct', object: 'model', owned_by: 'Meta', active: true, context_window: 131072 }, { id: 'whisper-large-v3', object: 'model', owned_by: 'OpenAI', active: true, context_window: 448 }] };
const OPENAI = { object: 'list', data: [{ id: 'gpt-5-mini', object: 'model', created: 1, owned_by: 'openai' }, { id: 'text-embedding-3-small', object: 'model', owned_by: 'openai' }, { id: 'gpt-old', object: 'model', owned_by: 'openai', shutdown_date: '2020-06-01' }] };
const NVIDIA = { object: 'list', data: [{ id: 'meta/llama-3.2-11b-vision-instruct', object: 'model', created: 735790403, owned_by: 'meta' }, { id: 'nvidia/embed-qa-4', object: 'model', owned_by: 'nvidia' }] };

const ask = (provider, body, extra = {}) =>
  fetchModels({ provider, key: 'k-secret-123', fetchImpl: routes({ http: respond(body) }), now: Date.parse('2026-11-04'), ...extra });
const byId = (result, id) => result.models.find((m) => m.id === id);

// ----- 1. each provider and its response format -----
test('OpenRouter: modalities, tools, context, price, expiry; entries without an id are dropped', async () => {
  const result = await ask('openrouter', OPENROUTER, { key: '' });
  assert.equal(result.ok, true);
  assert.equal(result.models.length, 4);
  const hy4 = byId(result, 'tencent/hy4');
  assert.deepEqual(hy4.capabilities, { chat: 'supported', vision: 'supported', streaming: 'unknown', tools: 'supported' });
  assert.equal(hy4.contextWindow, 1048576);
  assert.equal(hy4.maxOutput, 65536);
  assert.deepEqual(hy4.pricing, { prompt: '0.000000417', completion: '0.0000012505' });
  assert.equal(byId(result, 'vendor/going-away').status, 'retired');
  assert.equal(byId(result, 'vendor/text-only').status, 'active');
});

test('OpenRouter is listed without a key, and the key is never sent to it', async () => {
  let seen = null;
  await fetchModels({ provider: 'openrouter', key: 'k-secret-123', fetchImpl: routes({ http: (url, init) => ((seen = init.headers), respond(OPENROUTER)) }) });
  assert.equal(seen.authorization, undefined);
});

test('Anthropic: capabilities, lifecycle, line, token limits; null capabilities stay unknown', async () => {
  const result = await ask('anthropic', ANTHROPIC);
  const haiku = byId(result, 'claude-haiku-5-5');
  assert.equal(haiku.capabilities.vision, 'supported');
  assert.equal(haiku.family, 'haiku');
  assert.equal(haiku.contextWindow, 200000);
  assert.equal(haiku.status, 'active');
  const old = byId(result, 'claude-old');
  assert.equal(old.capabilities.vision, 'unknown');
  assert.equal(old.status, 'retired');
  assert.equal(old.retiresAt, '2025-01-01');
});

test('Mistral: the capabilities object says chat, vision, tools; an embedding model is not chat', async () => {
  const result = await ask('mistral', MISTRAL);
  assert.deepEqual(byId(result, 'mistral-small-latest').capabilities, { chat: 'supported', vision: 'supported', streaming: 'unknown', tools: 'supported' });
  const embed = byId(result, 'mistral-embed');
  assert.equal(embed.capabilities.chat, 'unsupported');
  assert.equal(groupOf(embed), 'other');
});

test('Gemini: the native endpoint, ids without "models/", chat told by generateContent, vision unknown', async () => {
  let url = '';
  const result = await fetchModels({ provider: 'gemini', key: 'k-secret-123', fetchImpl: routes({ 'https://generativelanguage.googleapis.com/v1beta/models': (u) => ((url = u), respond(GEMINI)) }) });
  assert.match(url, /pageSize=1000&key=k-secret-123$/);
  const flash = byId(result, 'gemini-2.5-flash');
  assert.equal(flash.capabilities.chat, 'supported');
  assert.equal(flash.capabilities.vision, 'unknown');
  assert.equal(flash.contextWindow, 1048576);
  assert.equal(byId(result, 'text-embedding-004').capabilities.chat, 'unsupported');
});

test('Groq: active and context window only; a speech model is NOT told from a chat model by the API', async () => {
  const result = await ask('groq', GROQ);
  const scout = byId(result, 'meta-llama/llama-4-scout-17b-16e-instruct');
  assert.deepEqual(scout.capabilities, { chat: 'unknown', vision: 'unknown', streaming: 'unknown', tools: 'unknown' });
  assert.equal(scout.contextWindow, 131072);
  assert.equal(byId(result, 'whisper-large-v3').capabilities.chat, 'unknown');
  assert.equal(byId(result, 'whisper-large-v3').hint, 'audio'); // a warning from its name, never a capability
});

test('OpenAI: nothing about capabilities, shutdown_date gives the status', async () => {
  const result = await ask('openai', OPENAI);
  assert.equal(byId(result, 'gpt-5-mini').capabilities.vision, 'unknown');
  assert.equal(byId(result, 'gpt-old').status, 'retired');
  assert.equal(byId(result, 'gpt-old').retiresAt, '2020-06-01');
});

test('NVIDIA: id only, listed with or without a key', async () => {
  const result = await ask('nvidia', NVIDIA, { key: '' });
  assert.equal(result.ok, true);
  assert.equal(byId(result, 'meta/llama-3.2-11b-vision-instruct').capabilities.vision, 'unknown');
});

test('a custom base URL (Ollama…) is read as an OpenAI-compatible list', async () => {
  let url = '';
  const result = await fetchModels({ provider: 'openai', key: '', baseUrl: 'http://localhost:11434/v1/', fetchImpl: routes({ http: (u) => ((url = u), respond({ data: [{ id: 'llava:13b' }] })) }) });
  assert.equal(url, 'http://localhost:11434/v1/models');
  assert.equal(result.models[0].id, 'llava:13b');
});

test('pages are followed: Anthropic cursor, Gemini token', async () => {
  const urls = [];
  const pages = [{ data: [{ id: 'a' }], has_more: true, last_id: 'a' }, { data: [{ id: 'b' }], has_more: false, last_id: 'b' }];
  const anthropic = await fetchModels({ provider: 'anthropic', key: 'k', fetchImpl: routes({ http: (u) => (urls.push(u), respond(pages[urls.length - 1])) }) });
  assert.deepEqual(anthropic.models.map((m) => m.id), ['a', 'b']);
  assert.match(urls[1], /after_id=a$/);
  const tokens = [{ models: [{ name: 'models/x' }], nextPageToken: 'T1' }, { models: [{ name: 'models/y' }] }];
  let n = 0;
  const gemini = await fetchModels({ provider: 'gemini', key: 'k', fetchImpl: routes({ http: () => respond(tokens[n++]) }) });
  assert.deepEqual(gemini.models.map((m) => m.id), ['x', 'y']);
});

// ----- 2. invalid key, 3. API down, 4. empty or malformed -----
test('an invalid key: a clear message, never a throw, the key is nowhere in it', async () => {
  const result = await ask('mistral', {}, { fetchImpl: routes({ http: respond({ message: 'Unauthorized' }, 401) }) });
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'auth');
  assert.match(result.error.message, /refuse ta clé/);
  assert.ok(!JSON.stringify(result).includes('k-secret-123'));
});

test('Anthropic: a refused x-api-key is retried with a Bearer header (the docs example)', async () => {
  const sent = [];
  const result = await fetchModels({ provider: 'anthropic', key: 'k', fetchImpl: routes({ http: (u, init) => (sent.push(init.headers), sent.length === 1 ? respond({}, 401) : respond(ANTHROPIC)) }) });
  assert.equal(result.ok, true);
  assert.ok(sent[0]['x-api-key'] && !sent[0].authorization);
  assert.equal(sent[1].authorization, 'Bearer k');
});

test('a key-requiring provider without a key is not even called', async () => {
  let called = false;
  const result = await fetchModels({ provider: 'openai', key: '  ', fetchImpl: async () => ((called = true), respond(OPENAI)) });
  assert.equal(called, false);
  assert.equal(result.error.kind, 'nokey');
});

test('an unreachable API: network, timeout and server errors are all reported, none thrown', async () => {
  const down = await ask('openai', {}, { fetchImpl: async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }); } });
  assert.equal(down.error.kind, 'network');
  const hung = await ask('openai', {}, { timeoutMs: 20, fetchImpl: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))) });
  assert.equal(hung.error.kind, 'timeout');
  const busy = await ask('openai', {}, { fetchImpl: routes({ http: respond({}, 503) }) });
  assert.equal(busy.error.kind, 'http');
  assert.match(busy.error.message, /503/);
});

test('an empty or malformed answer is a message, not a crash; an empty list is an empty list', async () => {
  for (const body of [{}, { data: 'oops' }, [], null, 'not json']) {
    const result = await ask('openai', null, { fetchImpl: async () => ({ ok: true, status: 200, json: async () => { if (body === 'not json') throw new SyntaxError('x'); return body; } }) });
    assert.equal(result.ok, false, JSON.stringify(body));
    assert.equal(result.error.kind, 'malformed');
  }
  const empty = await ask('openai', { data: [] });
  assert.deepEqual([empty.ok, empty.models], [true, []]);
});

// ----- 5-7. embedding, chat without vision, vision -----
test('groups: vision / to confirm / text only / other, and the name is only a warning', () => {
  const mk = (provider, found) => makeModel(provider, found);
  const embedding = mk('openrouter', { id: 'a/embed', chat: 'unsupported' });
  const textOnly = mk('openrouter', { id: 'a/text', chat: 'supported', vision: 'unsupported' });
  const vision = mk('openrouter', { id: 'a/vision', chat: 'supported', vision: 'supported' });
  const unknownOpenAI = mk('openai', { id: 'gpt-5-mini' });
  const unknownEmbeddingName = mk('openai', { id: 'text-embedding-3-small' });
  const groups = groupModels([embedding, textOnly, vision, unknownOpenAI, unknownEmbeddingName]);
  assert.deepEqual(groups.vision.map((m) => m.id), ['a/vision']);
  assert.deepEqual(groups.confirm.map((m) => m.id), ['gpt-5-mini']);
  assert.deepEqual(groups.text.map((m) => m.id), ['a/text']);
  assert.deepEqual(groups.other.map((m) => m.id).sort(), ['a/embed', 'text-embedding-3-small']);
  // The name made no capability up:
  assert.equal(unknownEmbeddingName.capabilities.chat, 'unknown');
  assert.equal(unknownEmbeddingName.hint, 'embedding');
  assert.equal(nameHint('gpt-5-mini'), null);
});

test('a retired model is never offered as a choice', () => {
  assert.equal(groupOf(makeModel('anthropic', { id: 'claude-old', vision: 'supported', status: 'retired' })), 'other');
});

// ----- 8. a manual identifier -----
test('a typed id is kept: absent from the list, retired, or not a chat model, it is flagged and never erased', async () => {
  const result = await ask('openrouter', OPENROUTER, { key: '' });
  assert.equal(selectionStatus(result.models, 'tencent/hy4'), 'listed');
  assert.equal(selectionStatus(result.models, 'my/custom-model'), 'absent');
  assert.equal(selectionStatus(result.models, 'vendor/going-away'), 'retired');
  assert.equal(selectionStatus(result.models, 'nvidia/some-embed'), 'not-chat');
  assert.equal(selectionStatus(result.models, '  '), 'none');
});

// ----- 9. removed or unavailable model: see the OpenAI shutdown_date, Anthropic lifecycle and OpenRouter expiry above -----

// ----- the test call settles what the list could not say -----
test('a test call proves vision, or its absence; a failure about the key says nothing', () => {
  const openai = makeModel('openai', { id: 'gpt-5-mini' });
  const ok = applyVerification(openai, { ok: true });
  assert.deepEqual(ok.capabilities, { chat: 'supported', vision: 'supported', streaming: 'supported', tools: 'unknown' });
  assert.equal(ok.verified, true);
  assert.equal(applyVerification(openai, { ok: false, kind: 'image' }).capabilities.vision, 'unsupported');
  assert.equal(applyVerification(openai, { ok: false, kind: 'auth' }), openai);
  assert.equal(applyVerification(openai, undefined), openai);
});

// ----- the service: cache, fallbacks, nothing secret on disk, the config untouched -----
function service(map, getKey = () => 'k-secret-123', catalog = null) {
  const dir = mkdtempSync(join(tmpdir(), 'judith-models-'));
  const clock = { t: 1_000_000 };
  return { dir, clock, svc: createModelsService({ dir, getKey, fetchImpl: routes(map), now: () => clock.t, catalog }) };
}

test('the list is fetched once, then served from the cache for 24 h, and a refresh asks again', async () => {
  let calls = 0;
  const { svc, clock } = service({ http: () => (calls++, respond(OPENAI)) });
  assert.equal((await svc.list({ provider: 'openai' })).source, 'api');
  assert.equal((await svc.list({ provider: 'openai' })).source, 'cache');
  assert.equal(calls, 1);
  assert.equal((await svc.list({ provider: 'openai', refresh: true })).source, 'api');
  clock.t += CACHE_TTL_MS + 1;
  assert.equal((await svc.list({ provider: 'openai' })).source, 'api');
  assert.equal(calls, 3);
});

test('when the provider is down: the last list, marked stale; with none, the built-in suggestions', async () => {
  let up = true;
  const { svc, clock } = service({ http: () => (up ? respond(OPENAI) : respond({}, 503)) });
  await svc.list({ provider: 'openai' });
  up = false;
  clock.t += CACHE_TTL_MS + 1;
  const stale = await svc.list({ provider: 'openai' });
  assert.deepEqual([stale.ok, stale.source, stale.stale, stale.error.kind], [true, 'cache', true, 'http']);
  assert.equal(stale.models.length, 3);
  const fresh = service({ http: () => respond({}, 503) });
  const fallback = await fresh.svc.list({ provider: 'nvidia' });
  assert.deepEqual([fallback.ok, fallback.source], [false, 'builtin']);
  assert.ok(fallback.models.length >= 1);
  assert.equal(fallback.models[0].capabilities.vision, 'unknown'); // the old hand-written list claimed images: not a proof
  assert.equal(fallback.models[0].source, 'builtin');
});

test('a verified model keeps its proof in the list, and the proof is on disk without any key', async () => {
  const { svc, dir } = service({ http: () => respond(OPENAI) });
  svc.recordVerification('openai', 'gpt-5-mini', { ok: true });
  svc.recordVerification('openai', 'gpt-old', { ok: false, kind: 'auth' }); // says nothing about the model: not kept
  const listed = await svc.list({ provider: 'openai' });
  assert.equal(listed.models.find((m) => m.id === 'gpt-5-mini').capabilities.vision, 'supported');
  assert.equal(listed.models.find((m) => m.id === 'gpt-old').verified, false);
  for (const file of readdirSync(dir)) assert.ok(!readFileSync(join(dir, file), 'utf8').includes('k-secret-123'), file);
});

test('a key typed but not saved yet is used for the call, and never written anywhere', async () => {
  let auth = null;
  const { svc, dir } = service({ http: (u, init) => ((auth = init.headers.authorization), respond(OPENAI)) }, () => '');
  const result = await svc.list({ provider: 'openai', key: 'typed-key-456' });
  assert.equal(auth, 'Bearer typed-key-456');
  assert.equal(result.ok, true);
  for (const file of readdirSync(dir)) assert.ok(!readFileSync(join(dir, file), 'utf8').includes('typed-key-456'), file);
});

test('the service never touches the settings: no config.json, only its two own files', async () => {
  const { svc, dir } = service({ http: () => respond(OPENAI) });
  await svc.list({ provider: 'openai' });
  svc.recordVerification('openai', 'gpt-5-mini', { ok: true });
  assert.deepEqual(readdirSync(dir).sort(), ['models-cache.json', 'models-verified.json']);
  assert.equal(existsSync(join(dir, 'config.json')), false);
});

test('an unknown provider answers, it does not throw', async () => {
  const { svc } = service({});
  const result = await svc.list({ provider: 'nope' });
  assert.equal(result.ok, false);
});

test('labels: tokens and prices as people read them', () => {
  assert.deepEqual([shortTokens(1048576), shortTokens(131072), shortTokens(800), shortTokens(null)], ['1M', '131k', '800', '']);
  assert.equal(priceLabel({ prompt: '0', completion: '0' }), 'gratuit');
  assert.equal(priceLabel({ prompt: '0.000001', completion: '0.000003' }), '1 / 3 $ par million');
  assert.equal(priceLabel(null), '');
});

test('a list that just failed is not asked again at once, but the Actualiser button still tries', async () => {
  let calls = 0;
  const { svc, clock } = service({ http: () => (calls++, respond({}, 429)) });
  const first = await svc.list({ provider: 'openai' });
  assert.equal(first.ok, false);
  const second = await svc.list({ provider: 'openai' });
  assert.equal(calls, 1, 'no second call during the pause');
  assert.equal(second.error.kind, 'http');
  await svc.list({ provider: 'openai', refresh: true });
  assert.equal(calls, 2);
  clock.t += 16_000;
  await svc.list({ provider: 'openai' });
  assert.equal(calls, 3, 'after the pause it asks again');
});

test('a missing key is not a failure to remember: pasting the key lists at once', async () => {
  const { svc } = service({ http: () => respond(OPENAI) }, () => '');
  assert.equal((await svc.list({ provider: 'openai' })).error.kind, 'nokey');
  assert.equal((await svc.list({ provider: 'openai', key: 'typed' })).ok, true);
});

test('waitTurn keeps a provider\'s calls apart, and does not wait when nothing was called', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'judith-wait-'));
  const svc = createModelsService({ dir, getKey: () => 'k', fetchImpl: routes({ http: respond(OPENAI) }), catalog: null });
  let started = Date.now();
  await svc.waitTurn('openai', 300);
  assert.ok(Date.now() - started < 100, 'nothing called yet: no wait');
  svc.touch('openai');
  started = Date.now();
  await svc.waitTurn('openai', 300);
  assert.ok(Date.now() - started >= 250, 'a call just happened: it waits');
});
