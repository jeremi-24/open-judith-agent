// How to list the models of each provider, from its OWN documentation.
// (Checked on the official pages in November 2026: see docs/MODELS.md.)
//
//   openrouter  GET {base}/models                      public, no key; architecture, pricing, tools, expiration_date
//   anthropic   GET {base}/models?limit=1000           capabilities.image_input, lifecycle, max_input_tokens; cursor pages
//   mistral     GET {base}/models                      capabilities.{completion_chat, vision, function_calling}
//   gemini      GET /v1beta/models?pageSize=1000&key=  NATIVE endpoint (the OpenAI-compatible one has no documented shape)
//   groq        GET {base}/models                      active, context_window; says nothing of vision or audio
//   openai      GET {base}/models                      id, owned_by, shutdown_date; nothing else
//   nvidia      GET {base}/models                      NOT documented by NVIDIA; answers without key; id, owned_by only
//
// A parser returns what its API says and nothing more: the rest stays unknown
// (see models.js). fetchModels never throws.
import { PROVIDERS } from './api.js';
import { flag, makeModel, SUPPORTED, UNKNOWN, UNSUPPORTED } from './models.js';

const GEMINI_NATIVE = 'https://generativelanguage.googleapis.com/v1beta';
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const count = (v) => (Number.isFinite(v) && v > 0 ? v : null);

// A date the API announces (YYYY-MM-DD or ISO) → { status, retiresAt }.
function lifecycleOf(date, now) {
  const day = text(date)?.slice(0, 10);
  if (!day) return { status: UNKNOWN, retiresAt: null };
  return { status: day <= new Date(now).toISOString().slice(0, 10) ? 'retired' : 'active', retiresAt: day };
}

// ----- parsers: JSON of one page → ModelInfo[] (entries without an id are dropped) -----
function parseOpenRouter(json, ctx) {
  return json.data.map((m) => {
    if (!isObject(m)) return null;
    const input = m.architecture?.input_modalities;
    const output = m.architecture?.output_modalities;
    const params = m.supported_parameters;
    const life = m.expiration_date ? lifecycleOf(m.expiration_date, ctx.now) : { status: 'active', retiresAt: null };
    return makeModel('openrouter', {
      id: m.id,
      name: m.name,
      chat: Array.isArray(output) ? (output.includes('text') ? SUPPORTED : UNSUPPORTED) : UNKNOWN,
      vision: Array.isArray(input) ? (input.includes('image') ? SUPPORTED : UNSUPPORTED) : UNKNOWN,
      tools: Array.isArray(params) ? (params.includes('tools') ? SUPPORTED : UNSUPPORTED) : UNKNOWN,
      contextWindow: m.context_length,
      maxOutput: m.top_provider?.max_completion_tokens,
      pricing: isObject(m.pricing) && 'prompt' in m.pricing && 'completion' in m.pricing ? { prompt: m.pricing.prompt, completion: m.pricing.completion } : null,
      ...life,
    });
  });
}

function parseAnthropic(json) {
  return json.data.map((m) => {
    if (!isObject(m)) return null;
    const caps = isObject(m.capabilities) ? m.capabilities : null;
    const life = ['active', 'deprecated', 'retired'].includes(m.lifecycle) ? m.lifecycle : UNKNOWN;
    return makeModel('anthropic', {
      id: m.id,
      name: m.display_name,
      family: text(m.line),
      vision: caps ? flag(caps.image_input) : UNKNOWN,
      contextWindow: m.max_input_tokens,
      maxOutput: m.max_tokens,
      status: life,
      retiresAt: text(m.retires_at)?.slice(0, 10) ?? null,
    });
  });
}

function parseMistral(json) {
  return json.data.map((m) => {
    if (!isObject(m)) return null;
    const caps = isObject(m.capabilities) ? m.capabilities : null;
    return makeModel('mistral', {
      id: m.id,
      name: m.name,
      chat: caps ? flag(caps.completion_chat) : UNKNOWN,
      vision: caps ? flag(caps.vision) : UNKNOWN,
      tools: caps ? flag(caps.function_calling) : UNKNOWN,
      contextWindow: m.max_context_length,
      status: m.archived === true ? 'retired' : UNKNOWN,
    });
  });
}

function parseGemini(json) {
  return json.models.map((m) => {
    if (!isObject(m)) return null;
    const name = text(m.name);
    if (!name) return null;
    const methods = m.supportedGenerationMethods;
    return makeModel('gemini', {
      // The OpenAI-compatible endpoint Judith calls takes the bare id.
      id: name.replace(/^models\//, ''),
      name: m.displayName,
      chat: Array.isArray(methods) ? (methods.includes('generateContent') ? SUPPORTED : UNSUPPORTED) : UNKNOWN,
      contextWindow: m.inputTokenLimit,
      maxOutput: m.outputTokenLimit,
    });
  });
}

function parseGroq(json) {
  return json.data.map((m) => (isObject(m) ? makeModel('groq', { id: m.id, contextWindow: m.context_window, status: m.active === true ? 'active' : UNKNOWN }) : null));
}

function parseOpenAI(json, ctx) {
  return json.data.map((m) => (isObject(m) ? makeModel('openai', { id: m.id, ...lifecycleOf(m.shutdown_date, ctx.now) }) : null));
}

// NVIDIA, and any OpenAI-compatible server the user points to (Ollama…).
function parseCompatible(json, ctx) {
  return json.data.map((m) => (isObject(m) ? makeModel(ctx.provider, { id: m.id }) : null));
}

// ----- how to ask -----
// keyRequired: without a key the call is not even tried.
// pages(first, json): the next URL, or null.
export const SOURCES = {
  openrouter: { keyRequired: false, sendKey: false, list: (base) => `${base}/models`, parse: parseOpenRouter, shape: 'data' },
  anthropic: {
    keyRequired: true,
    list: (base) => `${base}/models?limit=1000`,
    // The documentation's example uses a Bearer header, Judith's messages use x-api-key:
    // try the second only when the first is refused.
    auth: (key) => [
      { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      { authorization: `Bearer ${key}`, 'anthropic-version': '2023-06-01' },
    ],
    next: (url, json) => (json.has_more === true && text(json.last_id) ? `${url.split('&after_id=')[0]}&after_id=${encodeURIComponent(json.last_id)}` : null),
    parse: parseAnthropic,
    shape: 'data',
  },
  mistral: { keyRequired: true, list: (base) => `${base}/models`, parse: parseMistral, shape: 'data' },
  gemini: {
    keyRequired: true,
    native: true,
    list: (_base, key) => `${GEMINI_NATIVE}/models?pageSize=1000&key=${encodeURIComponent(key)}`,
    auth: () => [{}],
    next: (url, json) => (text(json.nextPageToken) ? `${url.split('&pageToken=')[0]}&pageToken=${encodeURIComponent(json.nextPageToken)}` : null),
    parse: parseGemini,
    shape: 'models',
  },
  groq: { keyRequired: true, list: (base) => `${base}/models`, parse: parseGroq, shape: 'data' },
  openai: { keyRequired: true, list: (base) => `${base}/models`, parse: parseOpenAI, shape: 'data' },
  nvidia: { keyRequired: false, list: (base) => `${base}/models`, parse: parseCompatible, shape: 'data' },
};

const FALLBACK = { keyRequired: false, list: (base) => `${base}/models`, parse: parseCompatible, shape: 'data' };

// ----- errors, in plain words (never the key, never a URL carrying it) -----
function httpError(status, label) {
  const make = (kind, message) => ({ kind, message, status });
  if (status === 401 || status === 403) return make('auth', `${label} refuse ta clé : vérifie qu'elle est complète et valide. Tu peux quand même saisir un modèle à la main.`);
  if (status === 404) return make('http', `${label} ne propose pas de liste de modèles à cette adresse. Saisis le modèle à la main.`);
  if (status === 429) return make('http', `${label} limite les demandes : réessaie dans un instant.`);
  if (status >= 500) return make('http', `${label} a un problème de son côté (erreur ${status}). Réessaie dans un moment.`);
  return make('http', `${label} a répondu ${status}. Saisis le modèle à la main si besoin.`);
}

// → { ok: true, models } or { ok: false, error: { kind, message } }. Never throws.
// kind: nokey | auth | network | timeout | malformed | http
export async function fetchModels({ provider, key = '', baseUrl = '', fetchImpl = fetch, timeoutMs = 15000, maxPages = 6, now = Date.now() }) {
  const spec = PROVIDERS[provider];
  if (!spec) return { ok: false, error: { kind: 'http', message: `Fournisseur inconnu : ${provider}.` } };
  const custom = Boolean(baseUrl);
  const source = custom ? FALLBACK : SOURCES[provider] ?? FALLBACK;
  const label = custom ? 'Le serveur' : spec.label;
  const cleaned = String(key ?? '').trim();
  if (source.keyRequired && !cleaned && !custom) {
    return { ok: false, error: { kind: 'nokey', message: `Colle ta clé ${spec.label} pour voir ses modèles. Tu peux déjà saisir un modèle à la main.` } };
  }
  const base = (baseUrl || spec.baseUrl).replace(/\/+$/, '');
  const authVariants = source.auth ? source.auth(cleaned) : cleaned && source.sendKey !== false ? [{ authorization: `Bearer ${cleaned}` }] : [{}];

  const ctx = { provider, now };
  const models = [];
  let url = source.list(base, cleaned);
  for (let page = 0; url && page < maxPages; page += 1) {
    let json = null;
    let failure = null;
    for (const headers of authVariants) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, { headers: { accept: 'application/json', ...headers }, signal: controller.signal });
        if (!response.ok) {
          failure = httpError(response.status, label);
          if ((response.status === 401 || response.status === 403) && headers !== authVariants.at(-1)) continue;
          break;
        }
        try {
          json = await response.json();
        } catch {
          failure = { kind: 'malformed', message: `${label} a répondu autre chose qu'une liste de modèles. Saisis le modèle à la main.` };
        }
        break;
      } catch (error) {
        failure = controller.signal.aborted
          ? { kind: 'timeout', message: `${label} ne répond pas à temps. Vérifie ta connexion, ou saisis le modèle à la main.` }
          : { kind: 'network', message: `Je n'arrive pas à joindre ${label}. Vérifie ta connexion internet, ou saisis le modèle à la main.` };
        break;
      } finally {
        clearTimeout(timer);
      }
    }
    if (!json) {
      // A later page failing keeps the models already read.
      if (page > 0 && models.length) return { ok: true, models, partial: true };
      return { ok: false, error: failure ?? { kind: 'malformed', message: `${label} n'a rien répondu d'utilisable.` } };
    }
    if (!isObject(json) || !Array.isArray(json[source.shape])) {
      if (page > 0 && models.length) return { ok: true, models, partial: true };
      return { ok: false, error: { kind: 'malformed', message: `${label} a répondu autre chose qu'une liste de modèles. Saisis le modèle à la main.` } };
    }
    let parsed;
    try {
      parsed = source.parse(json, ctx);
    } catch {
      return { ok: false, error: { kind: 'malformed', message: `La liste de ${label} est illisible. Saisis le modèle à la main.` } };
    }
    models.push(...parsed.filter(Boolean));
    url = source.next?.(url, json) ?? null;
  }
  // The same id twice (aliases, pages that overlap): the first one wins.
  const seen = new Set();
  return { ok: true, models: models.filter((m) => !seen.has(m.id) && seen.add(m.id)) };
}
