# Models: how Judith lists and judges them

The settings list the models of the chosen provider ("Clé API" engine). Three rules:

1. **Nothing is guessed from a name.** A capability is `supported`, `unsupported` or `unknown`.
   A name that looks like an embedding or an audio model only adds a *warning*.
2. **Judith never fails because a list failed.** Timeout, bad key, malformed answer: a message,
   the last list we had (marked stale), else a short built-in list, and the model can always be
   typed by hand.
3. **Order of trust:** the provider's own list, then a real test call on this PC (the **Tester**
   button sends text + an image, streamed), then the models.dev catalog, then `unknown`.

## Endpoints (read on the official documentation, November 2026)

| Provider | Request | What its list says |
| --- | --- | --- |
| OpenRouter | `GET https://openrouter.ai/api/v1/models` (public, no key sent) | `architecture.input_modalities` / `output_modalities`, `supported_parameters`, `context_length`, `pricing`, `expiration_date` |
| Anthropic | `GET /v1/models?limit=1000`, cursor `after_id` | `capabilities.image_input`, `lifecycle`, `max_input_tokens`, `max_tokens`, `retires_at`. Auth: `x-api-key`, else `Authorization: Bearer` (the docs example) |
| Mistral | `GET /v1/models` | `capabilities.{completion_chat, vision, function_calling}`, `max_context_length`, `archived` |
| Gemini | `GET https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=…` (the native endpoint: the OpenAI-compatible one has no documented shape) | `supportedGenerationMethods`, `inputTokenLimit`, `outputTokenLimit` |
| Groq | `GET /openai/v1/models` | `active`, `context_window`. Nothing about vision or audio |
| OpenAI | `GET /v1/models` | `id`, `owned_by`, `shutdown_date`. Nothing about capabilities |
| NVIDIA | `GET /v1/models` (**not documented by NVIDIA**; it answers without a key) | `id`, `owned_by` only |

A custom base URL (Ollama…) is read as an OpenAI-compatible list. Keys go only to their own
provider, are never written to a cache, a log or an error message.

## The models.dev catalog

[models.dev](https://models.dev) (MIT, community maintained) says what most lists do not:
`modalities` (images in), `tool_call`, `open_weights`, `limit`, `cost`, `status`, `type`
(embedding, transcription, speech, image, reranking…).

- `scripts/sync-catalog.mjs` trims its 5.7 MB `api.json` to `src/engine/catalog.snapshot.json`
  (~130 KB, the 7 providers, only the fields we use). It is shipped with the app: nobody
  downloads the catalog at run time. Renew it before a release: `node scripts/sync-catalog.mjs`.
- It only fills fields still `unknown`, by **exact** provider and model id, and every field it
  filled is listed in `fromCatalog`: the interface draws those with a dashed outline
  ("declared by the catalog, not by the provider").
- Measured on 2026-11-04: of OpenRouter's 454 live models, 377 are in the catalog and on those the
  catalog agrees with OpenRouter's own list on images and text output 377 times out of 377.
  NVIDIA: only 26 of 85 live models are in the catalog (Phi-3 Vision is not), so most NVIDIA
  models stay `unknown` until the Test button proves them.
- `open_weights` means the weights are public. It does not mean free, nor open source.

## Cache

`models-cache.json` (24 h) and `models-verified.json` (what test calls proved) in the user data
folder. Neither holds a key. A list is only requested when the settings open on that provider
or on the Actualiser button (OpenRouter's is ~800 KB).

## Not verified (needs a real key)

Anthropic's `/models` authentication header (the documentation and Judith's messages differ),
Mistral's card field types and Gemini's list with a real key were written from the
documentation and tested with simulated answers.
