// What the models.dev catalog adds to a provider's own list (see
// scripts/sync-catalog.mjs: a community catalog, MIT, shipped as a snapshot).
//
// Order of trust, strongest first:
//   1. the provider's own list (model-sources.js)
//   2. a real test call on this PC (applyVerification, models.js)
//   3. the catalog: it only fills what is still 'unknown', found by the EXACT
//      provider and model id (never by looking alike), and every field it
//      filled is listed in `fromCatalog` so the interface says so.
//   4. unknown
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SUPPORTED, UNKNOWN, UNSUPPORTED } from './models.js';

// A catalog `type` that is not conversation (the catalog leaves it out for chat models).
const NOT_CHAT = new Set(['embedding', 'transcription', 'speech', 'image', 'video', 'realtime', 'reranking']);

// → the snapshot, or null when it is missing or unreadable (Judith works without it).
export function loadCatalog(file = join(import.meta.dirname, 'catalog.snapshot.json')) {
  try {
    const snapshot = JSON.parse(readFileSync(file, 'utf8'));
    return snapshot && typeof snapshot.providers === 'object' ? snapshot : null;
  } catch {
    return null;
  }
}

const state = (value) => (value === true ? SUPPORTED : value === false ? UNSUPPORTED : UNKNOWN);

export function enrichFromCatalog(model, catalog) {
  const entry = catalog?.providers?.[model.provider]?.[model.id];
  if (!entry || typeof entry !== 'object') return model;
  const from = [];
  const capabilities = { ...model.capabilities };
  const out = { ...model, capabilities };

  // Conversation: a declared special type is not chat; a declared text output is.
  if (capabilities.chat === UNKNOWN) {
    if (entry.type && NOT_CHAT.has(entry.type)) capabilities.chat = UNSUPPORTED;
    else if (entry.text === true) capabilities.chat = SUPPORTED;
    if (capabilities.chat !== UNKNOWN) from.push('chat');
  }
  // Images and tools: only for a model that talks.
  if (capabilities.chat !== UNSUPPORTED) {
    for (const [key, value] of [['vision', entry.vision], ['tools', entry.tools]]) {
      if (capabilities[key] === UNKNOWN && state(value) !== UNKNOWN) {
        capabilities[key] = state(value);
        from.push(key);
      }
    }
  }
  if (out.contextWindow == null && entry.context) (out.contextWindow = entry.context), from.push('context');
  if (out.maxOutput == null && entry.output) (out.maxOutput = entry.output), from.push('output');
  if (out.pricing == null && entry.price) {
    // The catalog gives dollars per million tokens; models carry the price of one token.
    out.pricing = { prompt: String(entry.price.input / 1e6), completion: String(entry.price.output / 1e6) };
    from.push('price');
  }
  if (out.status === UNKNOWN && entry.status === 'deprecated') (out.status = 'deprecated'), from.push('status');
  if (out.openWeights === UNKNOWN && typeof entry.openWeights === 'boolean') (out.openWeights = state(entry.openWeights)), from.push('openWeights');
  if (!out.family && entry.family) (out.family = entry.family), from.push('family');
  if (out.name === out.id && entry.name) out.name = entry.name;
  out.fromCatalog = [...(model.fromCatalog ?? []), ...from];
  return out;
}
