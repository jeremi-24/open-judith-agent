// Talks to a model through its HTTP API, with the user's own key.
// Two protocols cover most providers:
// - Anthropic's Messages API;
// - the OpenAI-compatible Chat Completions API: OpenAI, OpenRouter, Google
//   Gemini (its OpenAI endpoint), and local servers such as Ollama.
// Same contract as ClaudeCodeEngine: ask(content) streams 'delta' events and
// resolves with the answer, cancel() stops the turn.
//
// A bare model has no memory of the user's projects and no tools: it cannot
// call look_at_screen, so Judith sends the screenshot with every question
// (canLook = false).
import { t } from '../core/i18n.js';
import { EventEmitter } from 'node:events';
import { cleanKey, explainHttpError, explainNetworkError, explainStreamError } from './api-errors.js';

// model: a sensible default, editable in the settings (names change often).
// models: suggestions that SEE IMAGES (Judith sends the screen with each
// question), the first one is the default. free: a free tier exists (keys,
// quotas and limits are the provider's, and they change: see freeNote).
// keyPrefix: how the key starts, to help the user paste the right one.
export const PROVIDERS = {
  nvidia: {
    label: 'NVIDIA', protocol: 'openai', baseUrl: 'https://integrate.api.nvidia.com/v1', env: 'NVIDIA_API_KEY',
    free: true, freeNote: 'compte NVIDIA gratuit, environ 40 requêtes par minute', keyPrefix: 'nvapi-', keyUrl: 'https://build.nvidia.com/settings/api-keys',
    models: [
      { id: 'meta/llama-3.2-11b-vision-instruct', label: 'Llama 3.2 11B Vision' },
      { id: 'microsoft/phi-3-vision-128k-instruct', label: 'Phi-3 Vision' },
    ],
  },
  gemini: {
    label: 'Google Gemini', protocol: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', env: 'GEMINI_API_KEY',
    free: true, freeNote: 'offre gratuite avec limites quotidiennes', keyPrefix: 'AIza', keyUrl: 'https://aistudio.google.com/apikey',
    models: [{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }],
  },
  groq: {
    label: 'Groq', protocol: 'openai', baseUrl: 'https://api.groq.com/openai/v1', env: 'GROQ_API_KEY',
    free: true, freeNote: 'offre gratuite avec limites par minute et par jour', keyPrefix: 'gsk_', keyUrl: 'https://console.groq.com/keys',
    models: [{ id: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout' }],
  },
  mistral: {
    label: 'Mistral', protocol: 'openai', baseUrl: 'https://api.mistral.ai/v1', env: 'MISTRAL_API_KEY',
    free: true, freeNote: 'offre gratuite « Experiment » avec limites', keyUrl: 'https://console.mistral.ai/api-keys',
    models: [{ id: 'mistral-small-latest', label: 'Mistral Small' }],
  },
  anthropic: {
    label: 'Anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', env: 'ANTHROPIC_API_KEY',
    keyPrefix: 'sk-ant-', keyUrl: 'https://console.anthropic.com/settings/keys',
    models: [{ id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' }],
  },
  openai: {
    label: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', env: 'OPENAI_API_KEY',
    keyPrefix: 'sk-', keyUrl: 'https://platform.openai.com/api-keys',
    models: [{ id: 'gpt-5-mini', label: 'GPT-5 mini' }],
  },
  openrouter: {
    label: 'OpenRouter', protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1', env: 'OPENROUTER_API_KEY',
    keyPrefix: 'sk-or-', keyUrl: 'https://openrouter.ai/keys', models: [],
  },
};
// The model used when the settings name none.
export const defaultModel = (provider) => PROVIDERS[provider]?.models?.[0]?.id ?? '';

const MAX_TOKENS = 1024;

// Content blocks (Anthropic shape, as built by buildUserContent) for the
// OpenAI protocol.
export function toOpenAIContent(blocks) {
  return blocks.map((block) =>
    block.type === 'image'
      ? { type: 'image_url', image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` } }
      : { type: 'text', text: block.text },
  );
}

// The text of a user turn, without its images: earlier turns keep only their
// words (a screenshot per turn would be costly and soon out of date).
const textOf = (blocks) => blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');

// history: [{ role: 'user' | 'assistant', text }]; content: the new question.
export function buildRequest({ provider, model, key, baseUrl, system, history = [], content }) {
  const spec = PROVIDERS[provider];
  if (!spec) throw new Error(`Unknown provider: ${provider}`);
  const base = (baseUrl || spec.baseUrl).replace(/\/+$/, '');
  const chosen = model || defaultModel(provider);
  if (!chosen) throw new Error(t('Choisis un modèle pour {label} dans les réglages (son nom, comme sur son site).', { label: spec.label }));
  if (spec.protocol === 'anthropic') {
    return {
      url: `${base}/messages`,
      headers: { 'content-type': 'application/json', 'x-api-key': cleanKey(key), 'anthropic-version': '2023-06-01' },
      body: {
        model: chosen,
        max_tokens: MAX_TOKENS,
        system,
        stream: true,
        messages: [...history.map((m) => ({ role: m.role, content: m.text })), { role: 'user', content }],
      },
    };
  }
  return {
    url: `${base}/chat/completions`,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cleanKey(key)}` },
    body: {
      model: chosen,
      stream: true,
      messages: [
        { role: 'system', content: system },
        ...history.map((m) => ({ role: m.role, content: m.text })),
        { role: 'user', content: toOpenAIContent(content) },
      ],
    },
  };
}

// The text in one streamed event, or '' (an error event throws).
export function deltaOf(protocol, event) {
  if (protocol === 'anthropic') {
    if (event.type === 'error') throw new Error(event.error?.message ?? 'API error');
    return event.type === 'content_block_delta' && event.delta?.type === 'text_delta' ? event.delta.text : '';
  }
  if (event.error) throw new Error(event.error.message ?? 'API error');
  return event.choices?.[0]?.delta?.content ?? '';
}

// Server-sent events: feed it chunks of text, it calls onEvent with each
// parsed "data:" payload ("[DONE]" ends the OpenAI stream).
export function createSSEParser(onEvent) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        onEvent(JSON.parse(data));
      } catch (error) {
        if (error instanceof SyntaxError) continue;
        throw error;
      }
    }
  };
}

export class ApiEngine extends EventEmitter {
  canLook = false;

  constructor({ provider, model, key, baseUrl, systemPrompt, maxTurns = 6, fetchImpl = fetch }) {
    super();
    this.options = { provider, model, key, baseUrl, systemPrompt, maxTurns };
    this.fetch = fetchImpl;
    this.history = [];
    this.pending = null;
  }

  get busy() {
    return this.pending !== null;
  }

  start() {}

  stop() {
    this.cancel();
  }

  // A new conversation.
  restart() {
    this.cancel();
    this.history = [];
  }

  async ask(content) {
    if (this.pending) throw new Error('Judith is already answering');
    const { provider, model, key, baseUrl, systemPrompt, maxTurns } = this.options;
    if (!cleanKey(key)) throw new Error(t('Pas de clé API pour {label} : ajoute-la dans les réglages de Judith.', { label: PROVIDERS[provider]?.label ?? provider }));
    const request = buildRequest({ provider, model, key, baseUrl, system: systemPrompt, history: this.history, content });
    const controller = new AbortController();
    const pending = { controller, text: '' };
    this.pending = pending;
    const startedAt = Date.now();
    const spec = { id: provider, ...PROVIDERS[provider] };
    const custom = Boolean(baseUrl);
    try {
      let response;
      try {
        response = await this.fetch(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(request.body), signal: controller.signal });
      } catch (error) {
        if (controller.signal.aborted) throw error;
        throw explainNetworkError({ spec, error, base: baseUrl, custom });
      }
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const retry = Number.parseInt(response.headers?.get?.('retry-after') ?? '', 10);
        throw explainHttpError({ spec, status: response.status, body, model: request.body.model, custom, retryAfter: Number.isFinite(retry) ? retry : null });
      }
      const protocol = spec.protocol;
      const parse = createSSEParser((event) => {
        let delta;
        try {
          delta = deltaOf(protocol, event);
        } catch (error) {
          throw explainStreamError({ spec, message: error.message });
        }
        if (!delta) return;
        pending.text += delta;
        this.emit('delta', pending.text);
      });
      const decoder = new TextDecoder();
      try {
        for await (const chunk of response.body) parse(decoder.decode(chunk, { stream: true }));
      } catch (error) {
        if (controller.signal.aborted || error.kind) throw error;
        throw explainNetworkError({ spec, error, base: baseUrl, custom });
      }
      // A "thinking" model can spend its whole budget thinking and say nothing.
      if (!pending.text.trim()) throw Object.assign(new Error(t("{label} n'a rien répondu. Si c'est un modèle qui « réfléchit », essaie-en un autre dans les réglages.", { label: spec.label })), { kind: 'empty' });
      this.history.push({ role: 'user', text: textOf(content) }, { role: 'assistant', text: pending.text });
      this.history = this.history.slice(-2 * maxTurns);
      return { text: pending.text, streamed: pending.text, durationMs: Date.now() - startedAt };
    } catch (error) {
      if (controller.signal.aborted) throw Object.assign(new Error('cancelled'), { cancelled: true });
      throw error;
    } finally {
      if (this.pending === pending) this.pending = null;
    }
  }

  cancel() {
    this.pending?.controller.abort();
    this.pending = null;
  }
}
