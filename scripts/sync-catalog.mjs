// Builds src/engine/catalog.snapshot.json from models.dev (https://models.dev,
// MIT, a community-maintained catalog of models: modalities, tool calling, open
// weights, limits, prices, status). Only the 7 providers Judith talks to, and
// only the fields the settings use: ~5.7 MB become a few hundred KB, shipped in
// the app, so nobody downloads the catalog at run time.
//
// Usage:  node scripts/sync-catalog.mjs               download https://models.dev/api.json
//         node scripts/sync-catalog.mjs --from FILE   trim a file already downloaded
//
// The catalog is a hint source: a capability it declares is shown as "declared
// by the catalog", never as the provider's own word (see src/engine/catalog.js).
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const URL = 'https://models.dev/api.json';
const OUT = join(import.meta.dirname, '..', 'src', 'engine', 'catalog.snapshot.json');

// Judith's provider → the provider's id in models.dev.
export const CATALOG_IDS = { openai: 'openai', anthropic: 'anthropic', gemini: 'google', groq: 'groq', mistral: 'mistral', nvidia: 'nvidia', openrouter: 'openrouter' };

const flag = (v) => (typeof v === 'boolean' ? v : null);
const num = (v) => (Number.isFinite(v) && v > 0 ? v : null);

// One catalog model → the compact entry we keep. null = the catalog does not say.
export function trimModel(m) {
  const input = m.modalities?.input;
  const output = m.modalities?.output;
  return {
    name: typeof m.name === 'string' ? m.name : null,
    family: typeof m.family === 'string' ? m.family : null,
    vision: Array.isArray(input) ? input.includes('image') : null,
    text: Array.isArray(output) ? output.includes('text') : null,
    tools: flag(m.tool_call),
    openWeights: flag(m.open_weights),
    context: num(m.limit?.context),
    output: num(m.limit?.output),
    price: Number.isFinite(m.cost?.input) && Number.isFinite(m.cost?.output) ? { input: m.cost.input, output: m.cost.output } : null,
    status: ['alpha', 'beta', 'deprecated'].includes(m.status) ? m.status : null,
    type: typeof m.type === 'string' ? m.type : null,
  };
}

export function trimCatalog(all) {
  const providers = {};
  for (const [ours, theirs] of Object.entries(CATALOG_IDS)) {
    const models = all?.[theirs]?.models;
    if (!models || typeof models !== 'object') throw new Error(`models.dev has no provider "${theirs}" (for ${ours}): its format changed?`);
    providers[ours] = {};
    for (const [id, model] of Object.entries(models)) if (model && typeof model === 'object') providers[ours][id] = trimModel(model);
  }
  return providers;
}

async function main() {
  const from = process.argv.indexOf('--from');
  const raw = from > -1 ? readFileSync(process.argv[from + 1], 'utf8') : await (await fetch(URL)).text();
  const providers = trimCatalog(JSON.parse(raw));
  const snapshot = { source: URL, license: 'MIT, models.dev (https://github.com/anomalyco/models.dev)', generatedAt: new Date().toISOString().slice(0, 10), providers };
  writeFileSync(OUT, JSON.stringify(snapshot));
  const counts = Object.entries(providers).map(([p, m]) => `${p} ${Object.keys(m).length}`).join(', ');
  console.log(`catalog.snapshot.json: ${(statSync(OUT).size / 1024).toFixed(0)} KB (${counts})`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) await main();
