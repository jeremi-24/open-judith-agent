// One model format for every provider.
//
// Each provider's API says different things about its models (see
// model-sources.js). Whatever an API does not say stays 'unknown': a
// capability is never guessed from a model's name. The only name-based
// information is `hint`, a warning shown to the user, never a capability.
//
// @typedef {'supported' | 'unsupported' | 'unknown'} Capability
// @typedef {Object} ModelInfo
// @property {string} id            exact identifier to send to the provider's API
// @property {string} name          display name
// @property {string} provider      PROVIDERS key (nvidia, openrouter…)
// @property {string|null} family   model line when the API names it (Anthropic: haiku, sonnet…)
// @property {{ chat: Capability, vision: Capability, streaming: Capability, tools: Capability }} capabilities
// @property {number|null} contextWindow   tokens
// @property {number|null} maxOutput       tokens
// @property {{ prompt: string, completion: string }|null} pricing   per token, as the API gives it
// @property {'active' | 'deprecated' | 'retired' | 'unknown'} status
// @property {string|null} retiresAt       date (YYYY-MM-DD) when the API announces one
// @property {Capability} openWeights      open weights: only when a source states it (never a family name); NOT the same as free or open source
// @property {string[]} fromCatalog        the fields filled by the models.dev catalog, not by the provider (see catalog.js)
// @property {string|null} hint            'embedding' | 'audio' | 'image' | null: the NAME looks like it (a warning only)
// @property {'api' | 'builtin' | 'manual'} source   where the entry comes from
// @property {boolean} verified            a real test call (text + image, streamed) succeeded or failed on it

import { t } from '../core/i18n.js';

export const SUPPORTED = 'supported';
export const UNSUPPORTED = 'unsupported';
export const UNKNOWN = 'unknown';

const state = (value) => (value === true ? SUPPORTED : value === false ? UNSUPPORTED : UNKNOWN);

// A capability flag as an API writes it: true / false, or { supported: true }.
export function flag(value) {
  if (value && typeof value === 'object' && 'supported' in value) return state(value.supported);
  return state(typeof value === 'boolean' ? value : undefined);
}

const number = (value) => (Number.isFinite(value) && value > 0 ? value : null);

// What the model's NAME looks like. Only ever a warning, see the header.
export function nameHint(id) {
  const s = String(id ?? '').toLowerCase();
  if (/embed|rerank|moderat/.test(s)) return 'embedding';
  if (/whisper|tts|speech|transcri|audio/.test(s)) return 'audio';
  if (/dall-e|image-gen|imagen|flux|stable-diffusion|sdxl/.test(s)) return 'image';
  return null;
}

// A complete ModelInfo from what a provider's parser found (missing = unknown).
export function makeModel(provider, found) {
  const id = typeof found.id === 'string' ? found.id.trim() : '';
  if (!id) return null;
  return {
    id,
    name: (typeof found.name === 'string' && found.name.trim()) || id,
    provider,
    family: found.family ?? null,
    capabilities: {
      chat: found.chat ?? UNKNOWN,
      vision: found.vision ?? UNKNOWN,
      streaming: found.streaming ?? UNKNOWN,
      tools: found.tools ?? UNKNOWN,
    },
    contextWindow: number(found.contextWindow),
    maxOutput: number(found.maxOutput),
    pricing: found.pricing ?? null,
    status: found.status ?? UNKNOWN,
    retiresAt: found.retiresAt ?? null,
    openWeights: found.openWeights ?? UNKNOWN,
    hint: found.hint === undefined ? nameHint(id) : found.hint,
    source: found.source ?? 'api',
    verified: false,
    fromCatalog: [],
  };
}

// ----- what the user sees -----
// Groups, in the order of the list:
//   vision   the API says it reads images (and does not say it cannot chat)
//   confirm  the API says nothing about images: the Test button settles it
//   text     the API says it does not read images (kept apart, on request)
//   other    not a chat model (embedding, audio…) by the API, or by its name
export function groupOf(model) {
  const { chat, vision } = model.capabilities;
  if (chat === UNSUPPORTED || model.status === 'retired') return 'other';
  if (vision === SUPPORTED) return 'vision';
  if (vision === UNSUPPORTED) return 'text';
  if (model.hint) return 'other';
  return 'confirm';
}

export function groupModels(models) {
  const groups = { vision: [], confirm: [], text: [], other: [] };
  for (const model of models) groups[groupOf(model)].push(model);
  const byName = (a, b) => a.name.localeCompare(b.name);
  for (const list of Object.values(groups)) list.sort(byName);
  return groups;
}

// What the settings hold (provider, model id) against the list:
//   listed     the id is in the list
//   absent     not in the list (typed by hand, or removed by the provider): kept, never deleted
//   retired    the API says it is retired
//   not-chat   the list says it is not a conversation model
export function selectionStatus(models, id) {
  const wanted = String(id ?? '').trim();
  if (!wanted) return 'none';
  const found = models.find((m) => m.id === wanted);
  if (!found) return 'absent';
  if (found.status === 'retired') return 'retired';
  if (found.capabilities.chat === UNSUPPORTED) return 'not-chat';
  return 'listed';
}

// A test call (text + image + streaming) settled what the API could not say.
// outcome: { ok: true } or { ok: false, kind } with the error kind of api-errors.js.
export function applyVerification(model, outcome) {
  if (!outcome) return model;
  const capabilities = { ...model.capabilities };
  if (outcome.ok) {
    capabilities.chat = SUPPORTED;
    capabilities.vision = SUPPORTED;
    capabilities.streaming = SUPPORTED;
  } else if (outcome.kind === 'image') {
    capabilities.vision = UNSUPPORTED;
  } else {
    return model; // a failure that says nothing about capabilities (key, quota, network…)
  }
  return { ...model, capabilities, verified: true };
}

// "128k", "1M", or '' when unknown.
export function shortTokens(count) {
  if (!count) return '';
  if (count >= 1_000_000) return `${+(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1000) return `${Math.round(count / 1000)}k`;
  return String(count);
}

// Dollars per million tokens, or '' (free: 'gratuit'), from the per-token strings OpenRouter gives.
export function priceLabel(pricing) {
  if (!pricing) return '';
  const prompt = Number(pricing.prompt);
  const completion = Number(pricing.completion);
  if (!Number.isFinite(prompt) || !Number.isFinite(completion)) return '';
  if (prompt === 0 && completion === 0) return t('gratuit');
  const per = (v) => `${+(v * 1_000_000).toFixed(2)}`;
  return t('{prompt} / {completion} $ par million', { prompt: per(prompt), completion: per(completion) });
}
