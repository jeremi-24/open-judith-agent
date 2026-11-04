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
import { EventEmitter } from 'node:events';

// model: a sensible default, editable in the settings (names change often).
export const PROVIDERS = {
  anthropic: { label: 'Anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-haiku-5-5', env: 'ANTHROPIC_API_KEY' },
  openai: { label: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini', env: 'OPENAI_API_KEY' },
  gemini: { label: 'Google Gemini', protocol: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', env: 'GEMINI_API_KEY' },
  openrouter: { label: 'OpenRouter', protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: '', env: 'OPENROUTER_API_KEY' },
};

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
  const chosen = model || spec.model;
  if (!chosen) throw new Error(`Choose a model for ${spec.label} in the settings.`);
  if (spec.protocol === 'anthropic') {
    return {
      url: `${base}/messages`,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
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
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
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
    if (!key) throw new Error(`No API key for ${PROVIDERS[provider]?.label ?? provider}: add it in Judith's settings.`);
    const request = buildRequest({ provider, model, key, baseUrl, system: systemPrompt, history: this.history, content });
    const controller = new AbortController();
    const pending = { controller, text: '' };
    this.pending = pending;
    const startedAt = Date.now();
    try {
      const response = await this.fetch(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(request.body), signal: controller.signal });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`${PROVIDERS[provider].label} ${response.status}: ${detail.slice(0, 300)}`);
      }
      const protocol = PROVIDERS[provider].protocol;
      const parse = createSSEParser((event) => {
        const delta = deltaOf(protocol, event);
        if (!delta) return;
        pending.text += delta;
        this.emit('delta', pending.text);
      });
      const decoder = new TextDecoder();
      for await (const chunk of response.body) parse(decoder.decode(chunk, { stream: true }));
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
