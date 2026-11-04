import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enrichFromCatalog, loadCatalog } from '../src/engine/catalog.js';
import { applyVerification, groupOf, makeModel } from '../src/engine/models.js';
import { createModelsService } from '../src/main/models-service.js';
import { CATALOG_IDS, trimCatalog, trimModel } from '../scripts/sync-catalog.mjs';

const entry = (over = {}) => ({ name: null, family: null, vision: null, text: null, tools: null, openWeights: null, context: null, output: null, price: null, status: null, type: null, ...over });
const CATALOG = {
  providers: {
    openai: {
      'gpt-5-mini': entry({ name: 'GPT-5 mini', family: 'gpt-mini', vision: true, text: true, tools: true, openWeights: false, context: 400000, output: 128000, price: { input: 0.25, output: 2 } }),
      'text-embedding-3-small': entry({ type: 'embedding', vision: true, text: false }),
      'gpt-old': entry({ vision: false, text: true, status: 'deprecated' }),
    },
    openrouter: { 'vendor/text-only': entry({ vision: true, text: true }) }, // the catalog is wrong here on purpose
    nvidia: { 'meta/llama-3.2-11b-vision-instruct': entry({ vision: true, text: true, openWeights: true }) },
  },
};
const unknownModel = (provider, id) => makeModel(provider, { id });

test('the catalog fills what the provider left unknown, and says which fields', () => {
  const model = enrichFromCatalog(unknownModel('openai', 'gpt-5-mini'), CATALOG);
  assert.deepEqual(model.capabilities, { chat: 'supported', vision: 'supported', streaming: 'unknown', tools: 'supported' });
  assert.equal(model.contextWindow, 400000);
  assert.equal(model.maxOutput, 128000);
  assert.equal(Number(model.pricing.prompt) * 1e6, 0.25);
  assert.equal(Number(model.pricing.completion) * 1e6, 2);
  assert.equal(model.openWeights, 'unsupported');
  assert.equal(model.name, 'GPT-5 mini');
  assert.deepEqual([...model.fromCatalog].sort(), ['chat', 'context', 'family', 'openWeights', 'output', 'price', 'tools', 'vision']);
  assert.equal(groupOf(model), 'vision');
});

test('the provider wins over the catalog: a filled field is never overwritten', () => {
  const fromApi = makeModel('openrouter', { id: 'vendor/text-only', chat: 'supported', vision: 'unsupported', contextWindow: 32768 });
  const model = enrichFromCatalog(fromApi, CATALOG);
  assert.equal(model.capabilities.vision, 'unsupported');
  assert.equal(model.contextWindow, 32768);
  assert.ok(!model.fromCatalog.includes('vision'));
});

test('a real test call is stronger than the catalog', () => {
  const declared = enrichFromCatalog(unknownModel('openai', 'gpt-5-mini'), CATALOG);
  assert.equal(applyVerification(declared, { ok: false, kind: 'image' }).capabilities.vision, 'unsupported');
});

test('a non-conversation type is not chat, whatever the catalog says about images', () => {
  const embed = enrichFromCatalog(unknownModel('openai', 'text-embedding-3-small'), CATALOG);
  assert.equal(embed.capabilities.chat, 'unsupported');
  assert.equal(embed.capabilities.vision, 'unknown'); // not filled for a model that does not talk
  assert.equal(groupOf(embed), 'other');
});

test('matching is by exact id: a model that only looks alike gets nothing', () => {
  const near = enrichFromCatalog(unknownModel('openai', 'gpt-5-mini-2026'), CATALOG);
  assert.deepEqual(near.capabilities, { chat: 'unknown', vision: 'unknown', streaming: 'unknown', tools: 'unknown' });
  assert.deepEqual(near.fromCatalog, []);
  assert.equal(enrichFromCatalog(unknownModel('groq', 'gpt-5-mini'), CATALOG).fromCatalog.length, 0); // another provider
  assert.equal(enrichFromCatalog(unknownModel('openai', 'gpt-5-mini'), null).fromCatalog.length, 0); // no catalog: Judith works
});

test('deprecated status and open weights come from the catalog only as declared fields', () => {
  assert.equal(enrichFromCatalog(unknownModel('openai', 'gpt-old'), CATALOG).status, 'deprecated');
  const llama = enrichFromCatalog(unknownModel('nvidia', 'meta/llama-3.2-11b-vision-instruct'), CATALOG);
  assert.equal(llama.openWeights, 'supported');
  assert.ok(llama.fromCatalog.includes('openWeights'));
});

test('the service applies the catalog to a listed model, and to the built-in suggestions of a provider that is down', async () => {
  const up = createModelsService({
    dir: mkdtempSync(join(tmpdir(), 'judith-cat-')),
    getKey: () => 'k',
    catalog: CATALOG,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: 'gpt-5-mini', owned_by: 'openai' }] }) }),
  });
  const listed = await up.list({ provider: 'openai' });
  assert.equal(listed.models[0].capabilities.vision, 'supported');
  const down = createModelsService({ dir: mkdtempSync(join(tmpdir(), 'judith-cat-')), catalog: CATALOG, fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
  const fallback = await down.list({ provider: 'nvidia' });
  const llama = fallback.models.find((m) => m.id === 'meta/llama-3.2-11b-vision-instruct');
  assert.equal(llama.capabilities.vision, 'supported');
  assert.equal(llama.fromCatalog.includes('vision'), true);
});

test('the sync script trims a catalog model, and refuses a catalog whose format changed', () => {
  const trimmed = trimModel({ id: 'x', name: 'X', modalities: { input: ['text', 'image'], output: ['text'] }, tool_call: true, open_weights: false, limit: { context: 1000, output: 100 }, cost: { input: 1, output: 2 }, status: 'deprecated', type: 'embedding', description: 'dropped' });
  assert.deepEqual(trimmed, { name: 'X', family: null, vision: true, text: true, tools: true, openWeights: false, context: 1000, output: 100, price: { input: 1, output: 2 }, status: 'deprecated', type: 'embedding' });
  assert.equal(trimModel({ id: 'y' }).vision, null); // no modalities: the catalog does not say
  assert.throws(() => trimCatalog({ openai: { models: {} } }), /format changed/);
});

test('the shipped snapshot is valid: the 7 providers, small, with the right shape', () => {
  const file = join(import.meta.dirname, '..', 'src', 'engine', 'catalog.snapshot.json');
  assert.ok(statSync(file).size < 400 * 1024, 'a few hundred KB at most');
  const snapshot = loadCatalog(file);
  assert.deepEqual(Object.keys(snapshot.providers).sort(), Object.keys(CATALOG_IDS).sort());
  assert.match(snapshot.license, /MIT/);
  assert.equal(snapshot.providers.gemini['gemini-2.5-flash'].vision, true);
  assert.equal(snapshot.providers.nvidia['meta/llama-3.2-11b-vision-instruct'].openWeights, true);
  assert.equal(loadCatalog(join(tmpdir(), 'nope-no-such-file.json')), null);
  assert.ok(!/api[_-]?key|token|secret/i.test(readFileSync(file, 'utf8')));
});
