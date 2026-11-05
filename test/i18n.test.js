import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EN } from '../src/core/locales/en.js';
import { detectLanguage, keyOf, normalizeLanguage, setLanguage, t, translate } from '../src/core/i18n.js';
import { report } from '../scripts/i18n-keys.mjs';
import { explainHttpError, explainNetworkError } from '../src/engine/api-errors.js';
import { priceLabel } from '../src/engine/models.js';
import { buildSystemPrompt } from '../src/core/prompt.js';
import { fetchModels } from '../src/engine/model-sources.js';

// Runs something with Judith speaking English, and puts French back.
async function inEnglish(run) {
  setLanguage('en');
  try {
    return await run();
  } finally {
    setLanguage('fr');
  }
}

test('every sentence of the app has an English version, and none is left over', async () => {
  const { missing, unused } = await report();
  assert.deepEqual(missing.map(([key, where]) => `${where}: ${key}`), [], 'sentences without English (run: node scripts/i18n-keys.mjs)');
  assert.deepEqual(unused, [], 'English entries whose French sentence is gone');
});

test('a translation keeps the placeholders of its sentence, and is really English', () => {
  const names = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const [french, english] of Object.entries(EN)) {
    assert.equal(names(english), names(french), `placeholders differ: ${french}`);
    if (keyOf(french) !== 'Langue / Language') assert.doesNotMatch(english, /[àâçèêëîïôûùü]/i, `French letters in the English text: ${english}`);
  }
});

test('translate: French stays as written, English comes from the dictionary, the unknown stays itself', () => {
  assert.equal(translate('fr', 'Je réfléchis…'), 'Je réfléchis…');
  assert.equal(translate('en', 'Je réfléchis…'), 'Thinking…');
  assert.equal(translate('en', 'Une phrase que personne n’a traduite'), 'Une phrase que personne n’a traduite');
  assert.equal(translate('en', 'Étape {step}/{max}', { step: 2, max: 12 }), 'Step 2/12');
  assert.equal(translate('fr', 'Étape {step}/{max}', { step: 2, max: 12 }), 'Étape 2/12');
  assert.equal(translate('en', 'Étape {step}/{max}', { step: 2 }), 'Step 2/{max}', 'a missing value is left visible, never "undefined"');
});

test('apostrophes and spaces written two ways are one sentence', () => {
  assert.equal(translate('en', 'Je n’ai rien entendu.'), "I didn't hear anything.");
  assert.equal(translate('en', "Je n'ai   rien entendu."), "I didn't hear anything.");
  assert.equal(translate('en', 'Une autre zone ? La première reste à côté.'), 'Another zone? The first one stays beside it.');
});

test('the language of Windows decides the first start: French stays French, the rest is English', () => {
  assert.deepEqual(['fr-FR', 'fr-CA', 'fr', 'en-US', 'en-GB', 'de-DE', 'es', '', undefined].map(detectLanguage), ['fr', 'fr', 'fr', 'en', 'en', 'en', 'en', 'en', 'en']);
  assert.equal(normalizeLanguage('en'), 'en');
  assert.equal(normalizeLanguage('klingon'), 'fr');
});

test('the errors a user reads follow the language', async () => {
  const spec = { id: 'mistral', label: 'Mistral', keyPrefix: '', models: [] };
  const fr = explainHttpError({ spec, status: 401, body: '', model: 'm' }).message;
  assert.match(fr, /refuse ta clé API/);
  await inEnglish(() => {
    assert.match(explainHttpError({ spec, status: 401, body: '', model: 'm' }).message, /Mistral refuses your API key/);
    const rate = explainHttpError({ spec, status: 429, body: '{"message":"Service tier capacity exceeded for this model."}', model: 'm', retryAfter: 20 });
    assert.match(rate.message, /too many requests” \(429\) : Service tier capacity exceeded for this model\./);
    assert.match(rate.message, /wait 20 s/);
    assert.match(explainNetworkError({ spec, error: Object.assign(new Error('x'), { cause: { code: 'ENOTFOUND' } }) }).message, /Check your internet connection/);
    assert.equal(priceLabel({ prompt: '0', completion: '0' }), 'free');
    assert.equal(priceLabel({ prompt: '0.000001', completion: '0.000003' }), '1 / 3 $ per million');
  });
});

test('the model list errors follow the language too', async () => {
  const down = () => fetchModels({ provider: 'openai', key: 'k', fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
  assert.match((await down()).error.message, /problème de son côté/);
  await inEnglish(async () => assert.match((await down()).error.message, /has a problem on its side/));
});

test('the system prompt gives its examples and its offer in the language of the user', () => {
  const fr = buildSystemPrompt({ language: 'fr' });
  const en = buildSystemPrompt({ language: 'en' });
  assert.match(fr, /Le bouton \*\*Exporter\*\*/);
  assert.match(fr, /Tu veux que je te suive jusqu'au bout/);
  assert.match(en, /The \*\*Export\*\* button/);
  assert.doesNotMatch(en, /Le bouton \*\*Exporter\*\*|Tu veux que je te suive/);
  assert.match(en, /Do you want me to guide you all the way/);
});

test('t follows the current language', async () => {
  assert.equal(t('Quitter'), 'Quitter');
  await inEnglish(() => assert.equal(t('Quitter'), 'Quit'));
  assert.equal(t('Quitter'), 'Quitter');
});
