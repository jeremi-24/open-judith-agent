// Local speech-to-text with Whisper (transformers.js + ONNX Runtime).
// The model is downloaded once into the cache folder, then works offline.
import { env, pipeline } from '@huggingface/transformers';
import { fixName } from '../core/audio.js';

export { decodeWav, fixName } from '../core/audio.js';

export const DEFAULT_SPEECH_MODEL = 'onnx-community/whisper-base';
const LANGUAGES = { fr: 'french', en: 'english' };

export function createTranscriber({ model = DEFAULT_SPEECH_MODEL, cacheDir, language = 'fr' } = {}) {
  if (cacheDir) env.cacheDir = cacheDir;
  let loading = null;
  const load = () => (loading ??= pipeline('automatic-speech-recognition', model, { dtype: 'q8' }));

  return {
    // Loads the model ahead of time (the first load can take a while).
    warmUp: () => load().then(() => undefined),
    // audio: Float32Array, mono, 16 kHz.
    async transcribe(audio) {
      const recognizer = await load();
      const output = await recognizer(audio, { language: LANGUAGES[language] ?? language, task: 'transcribe' });
      return fixName(output?.text);
    },
  };
}
