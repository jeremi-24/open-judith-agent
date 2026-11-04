// The model lists the settings show: asked to the provider on demand, kept 24 h
// on disk (a list can weigh hundreds of KB: OpenRouter's is ~800 KB), merged
// with what real test calls proved, and never allowed to make Judith fail.
//
// Two small files in the user data folder, neither holds a key:
//   models-cache.json     { "provider|baseUrl": { fetchedAt, models } }
//   models-verified.json  { "provider|modelId": { ok, kind, at } }
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PROVIDERS } from '../engine/api.js';
import { enrichFromCatalog, loadCatalog } from '../engine/catalog.js';
import { fetchModels } from '../engine/model-sources.js';
import { applyVerification, makeModel } from '../engine/models.js';

export const CACHE_TTL_MS = 24 * 3600 * 1000;

function readJson(file) {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  } catch {
    return {};
  }
}

// Written aside then renamed: a crash never leaves half a file.
function writeJson(file, data) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(data));
    renameSync(`${file}.tmp`, file);
  } catch {
    // The cache is a convenience: losing it changes nothing but speed.
  }
}

// dir: the user data folder. getKey(provider) → the saved key or ''.
// catalog: the models.dev snapshot (null: none), which only fills what the provider's list leaves unknown.
export function createModelsService({ dir, getKey = () => '', fetchImpl = fetch, now = () => Date.now(), timeoutMs = 15000, catalog = loadCatalog() }) {
  const cacheFile = join(dir, 'models-cache.json');
  const verifiedFile = join(dir, 'models-verified.json');

  const builtin = (provider) => (PROVIDERS[provider]?.models ?? []).map((m) => makeModel(provider, { id: m.id, name: m.label, source: 'builtin', hint: null }));

  // Provider list, then the catalog for the gaps, then what test calls proved.
  function withVerification(provider, models) {
    const verified = readJson(verifiedFile);
    return models.map((m) => applyVerification(enrichFromCatalog(m, catalog), verified[`${provider}|${m.id}`]));
  }

  return {
    // → { ok, models, source: 'api' | 'cache' | 'builtin', fetchedAt, stale?, error? }
    // key: a key typed in the settings and not saved yet (it wins over the saved one).
    async list({ provider, baseUrl = '', key = '', refresh = false }) {
      if (!PROVIDERS[provider]) return { ok: false, models: [], source: 'builtin', fetchedAt: null, error: { kind: 'http', message: `Fournisseur inconnu : ${provider}.` } };
      const cacheKey = `${provider}|${baseUrl}`;
      const cache = readJson(cacheFile);
      const cached = cache[cacheKey];
      const fresh = cached && now() - cached.fetchedAt < CACHE_TTL_MS && Array.isArray(cached.models);
      if (fresh && !refresh) {
        return { ok: true, models: withVerification(provider, cached.models), source: 'cache', fetchedAt: cached.fetchedAt };
      }
      const result = await fetchModels({ provider, key: key || getKey(provider), baseUrl, fetchImpl, timeoutMs, now: now() });
      if (result.ok) {
        const fetchedAt = now();
        writeJson(cacheFile, { ...cache, [cacheKey]: { fetchedAt, models: result.models } });
        return { ok: true, models: withVerification(provider, result.models), source: 'api', fetchedAt, partial: result.partial === true };
      }
      // The provider cannot be reached: the last list we had, else the built-in suggestions.
      if (cached && Array.isArray(cached.models)) {
        return { ok: true, models: withVerification(provider, cached.models), source: 'cache', fetchedAt: cached.fetchedAt, stale: true, error: result.error };
      }
      return { ok: false, models: withVerification(provider, builtin(provider)), source: 'builtin', fetchedAt: null, error: result.error };
    },

    // A real test call (text + image, streamed) on this model succeeded or failed.
    // outcome: { ok: true } or { ok: false, kind } (error kind of api-errors.js).
    recordVerification(provider, id, outcome) {
      if (!PROVIDERS[provider] || !id) return;
      // Only outcomes that say something about the model are kept (see applyVerification).
      if (!outcome?.ok && outcome?.kind !== 'image') return;
      const verified = readJson(verifiedFile);
      verified[`${provider}|${id}`] = { ok: Boolean(outcome.ok), kind: outcome.kind ?? null, at: now() };
      writeJson(verifiedFile, verified);
    },
  };
}
