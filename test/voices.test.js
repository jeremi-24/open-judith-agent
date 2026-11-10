import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_VOICE_FOR, VOICES, localVoiceFor } from '../src/main/models.js';

test('each language has a local voice that can be downloaded', () => {
  for (const name of Object.values(LOCAL_VOICE_FOR)) {
    const voice = VOICES[name];
    assert.ok(voice, `${name} is declared`);
    assert.match(voice.url, /^https:\/\/github\.com\/k2-fsa\/sherpa-onnx\/releases\/download\/tts-models\/.+\.tar\.bz2$/);
    assert.ok(voice.url.endsWith(`${voice.folder}.tar.bz2`), 'the archive holds the folder of the same name');
    assert.ok(voice.model.endsWith('.onnx'));
  }
});

test('French uses Siwis, English uses Kristin, an unknown language falls back to French', () => {
  assert.equal(localVoiceFor('fr'), 'siwis');
  assert.equal(localVoiceFor('en'), 'kristin');
  assert.equal(localVoiceFor('de'), 'siwis');
});
