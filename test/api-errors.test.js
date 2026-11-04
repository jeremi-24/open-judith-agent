import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiEngine, PROVIDERS, buildRequest, defaultModel } from '../src/engine/api.js';
import { cleanKey, explainHttpError, explainNetworkError, explainStreamError, serverMessage } from '../src/engine/api-errors.js';

const ask = (text) => [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }, { type: 'text', text }];
const nvidia = { id: 'nvidia', ...PROVIDERS.nvidia };

test('providers: NVIDIA and the other free ones are there, each with a model that sees images', () => {
  for (const id of ['nvidia', 'gemini', 'groq', 'mistral']) assert.equal(PROVIDERS[id].free, true, id);
  assert.equal(PROVIDERS.nvidia.baseUrl, 'https://integrate.api.nvidia.com/v1');
  assert.equal(PROVIDERS.nvidia.keyPrefix, 'nvapi-');
  for (const [id, p] of Object.entries(PROVIDERS)) {
    assert.ok(p.label && p.baseUrl && p.env && p.keyUrl?.startsWith('https://'), id);
    if (id !== 'openrouter') assert.ok(defaultModel(id), `${id} has a default model`);
  }
  const r = buildRequest({ provider: 'nvidia', key: 'nvapi-x', system: 'S', content: ask('Hi') });
  assert.equal(r.url, 'https://integrate.api.nvidia.com/v1/chat/completions');
  assert.equal(r.headers.authorization, 'Bearer nvapi-x');
  assert.equal(r.body.model, 'meta/llama-3.2-11b-vision-instruct');
});

test('a pasted key is cleaned: spaces, quotes, "Bearer "', () => {
  assert.equal(cleanKey('  nvapi-abc \n'), 'nvapi-abc');
  assert.equal(cleanKey('"nvapi-abc"'), 'nvapi-abc');
  assert.equal(cleanKey('Bearer nvapi-abc'), 'nvapi-abc');
  assert.equal(cleanKey('nvapi-abc\ndef'), 'nvapi-abcdef');
  assert.equal(cleanKey(undefined), '');
  assert.equal(buildRequest({ provider: 'openai', key: ' sk-1 ', system: '', content: ask('x') }).headers.authorization, 'Bearer sk-1');
});

test('server messages: every usual JSON shape, plain text, and web pages are ignored', () => {
  assert.equal(serverMessage('{"error":{"message":"bad things"}}'), 'bad things');
  assert.equal(serverMessage('{"error":"nope"}'), 'nope');
  assert.equal(serverMessage('{"detail":"Function not found"}'), 'Function not found');
  assert.equal(serverMessage('{"detail":[{"msg":"field required"}]}'), 'field required');
  assert.equal(serverMessage('plain text'), 'plain text');
  assert.equal(serverMessage('<!DOCTYPE html><html>Bad gateway</html>'), '');
  assert.equal(serverMessage(''), '');
  assert.ok(serverMessage('x'.repeat(900)).length <= 200);
});

const explain = (status, body = '', extra = {}) => explainHttpError({ spec: nvidia, status, body, model: 'm/x', ...extra });

test('HTTP errors: a cause and what to do, in French', () => {
  const cases = [
    [401, /refuse ta clé API.*nvapi-/, 'auth'],
    [402, /crédits/, 'quota'],
    [403, /Try API/, 'auth'],
    [404, /« m\/x » n'existe pas chez NVIDIA.*autre dans les réglages/, 'model'],
    [413, /trop lourde/, 'size'],
    [504, /trop de temps/, 'timeout'],
    [500, /problème de son côté \(erreur 500\)/, 'server'],
    [503, /problème de son côté/, 'server'],
    [418, /a répondu 418/, 'request'],
  ];
  for (const [status, pattern, kind] of cases) {
    const error = explain(status);
    assert.match(error.message, pattern, String(status));
    assert.equal(error.kind, kind, String(status));
    assert.equal(error.status, status);
  }
  assert.match(explain(403, '', { spec: { id: 'groq', label: 'Groq' } }).message, /Groq refuse l'accès/);
});

test('400: a model that cannot read images says so and suggests one that can', () => {
  const error = explain(400, '{"error":{"message":"This model does not support image input"}}');
  assert.equal(error.kind, 'image');
  assert.match(error.message, /ne sait pas lire les images.*meta\/llama-3\.2-11b-vision-instruct/);
  assert.equal(explain(400, '{"error":{"message":"maximum context length is 8192 tokens"}}').kind, 'size');
  assert.match(explain(400, '{"error":{"message":"temperature must be below 2"}}').message, /a refusé la demande \(temperature must be below 2\)/);
});

test('429: slow down (with the wait) or the free quota is spent', () => {
  assert.match(explain(429, '', { retryAfter: 20 }).message, /attends 20 s/);
  assert.equal(explain(429).kind, 'rate');
  const quota = explain(429, '{"error":{"message":"You exceeded your current quota"}}');
  assert.equal(quota.kind, 'quota');
  assert.match(quota.message, /quota gratuit.*épuisé/);
});

test('a local server (Ollama…): errors talk about the server, not the provider', () => {
  assert.match(explain(404, '', { custom: true }).message, /Le serveur ne connaît pas/);
  const refused = explainNetworkError({ spec: nvidia, error: Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }), base: 'http://localhost:11434/v1', custom: true });
  assert.match(refused.message, /localhost:11434.*est-il lancé/);
});

test('network errors: offline, refused, timeout, cut, certificate, unknown', () => {
  const net = (code) => explainNetworkError({ spec: nvidia, error: Object.assign(new TypeError('fetch failed'), { cause: { code } }) });
  assert.match(net('ENOTFOUND').message, /Je ne trouve pas NVIDIA.*connexion internet/);
  assert.match(net('ECONNREFUSED').message, /refuse la connexion/);
  assert.match(net('UND_ERR_CONNECT_TIMEOUT').message, /ne répond pas à temps/);
  assert.match(net('ECONNRESET').message, /s'est coupée/);
  assert.match(net('UNABLE_TO_VERIFY_LEAF_SIGNATURE').message, /antivirus|certificat/);
  assert.match(net('???').message, /Je n'arrive pas à joindre NVIDIA/);
  assert.equal(net('ENOTFOUND').kind, 'network');
});

test('errors in the middle of a stream', () => {
  const s = (message) => explainStreamError({ spec: nvidia, message });
  assert.match(s('Overloaded').message, /surchargé/);
  assert.match(s('insufficient_quota').message, /quota gratuit/);
  assert.match(s('rate limit reached').message, /trop de demandes/);
  assert.match(s('boom').message, /a coupé sa réponse : boom/);
});

// A fake fetch answering with a status, headers and body.
const answer = ({ status = 200, body = '', headers = {}, chunks = [] } = {}) => async () => ({
  ok: status === 200,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  text: async () => body,
  body: (async function* () {
    for (const c of chunks) yield new TextEncoder().encode(c);
  })(),
});
const engineWith = (fetchImpl, extra = {}) => new ApiEngine({ provider: 'nvidia', key: 'nvapi-k', systemPrompt: '', fetchImpl, ...extra });

test('ApiEngine: the user reads French, not the provider\'s raw answer', async () => {
  await assert.rejects(engineWith(answer({ status: 404, body: '{"detail":"Function not found for account"}' }), { model: 'foo/bar' }).ask(ask('x')), /« foo\/bar » n'existe pas chez NVIDIA/);
  await assert.rejects(engineWith(answer({ status: 429, headers: { 'retry-after': '12' } })).ask(ask('x')), /attends 12 s/);
  await assert.rejects(engineWith(async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); }).ask(ask('x')), /Je ne trouve pas NVIDIA/);
  await assert.rejects(engineWith(answer({ chunks: ['data: {"error":{"message":"Overloaded"}}\n'] })).ask(ask('x')), /surchargé/);
  await assert.rejects(engineWith(answer({ chunks: ['data: {"choices":[{"delta":{"content":"  "}}]}\n', 'data: [DONE]\n'] })).ask(ask('x')), /n'a rien répondu/);
  await assert.rejects(new ApiEngine({ provider: 'nvidia', key: '  ', systemPrompt: '' }).ask(ask('x')), /Pas de clé API pour NVIDIA/);
});

test('ApiEngine: after an error the engine is free again, and a good answer still works', async () => {
  const engine = engineWith(answer({ status: 500 }));
  await assert.rejects(engine.ask(ask('x')), /problème de son côté/);
  assert.equal(engine.busy, false);
  engine.fetch = answer({ chunks: ['data: {"choices":[{"delta":{"content":"say ok"}}]}\n'] });
  assert.equal((await engine.ask(ask('x'))).text, 'say ok');
});
