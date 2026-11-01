// Judith's voice: a local neural voice (Piper, through sherpa-onnx). One
// sentence of ~6 s is ready in ~0.4 s on a laptop CPU.
// It runs in its own process: sherpa-onnx and Whisper each bring their own
// ONNX Runtime DLL, and Windows cannot load both in one process.
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const sherpa = require('sherpa-onnx-node');

const { path, model, speed = 1 } = JSON.parse(process.env.JUDITH_VOICE);
const tts = new sherpa.OfflineTts({
  model: {
    vits: { model: join(path, model), tokens: join(path, 'tokens.txt'), dataDir: join(path, 'espeak-ng-data') },
    numThreads: 2,
    provider: 'cpu',
  },
  maxNumSentences: 1,
});
process.send({ ready: true });

process.on('message', ({ id, text }) => {
  try {
    // Electron forbids "external" buffers: ask for a regular copy.
    const audio = tts.generate({ text, sid: 0, speed, enableExternalBuffer: false });
    process.send({ id, samples: audio.samples, sampleRate: audio.sampleRate });
  } catch (error) {
    process.send({ id, error: error.message });
  }
});
