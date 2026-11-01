// Transcribes a 16 kHz WAV file with Judith's local Whisper.
// Usage: node scripts/try-voice.mjs question.wav
import { readFileSync } from 'node:fs';
import { createTranscriber, decodeWav } from '../src/engine/speech-to-text.js';

const { samples, rate } = decodeWav(readFileSync(process.argv[2]));
if (rate !== 16000) throw new Error(`16 kHz expected, got ${rate} Hz`);

const transcriber = createTranscriber({ cacheDir: process.env.JUDITH_MODELS });
let t = Date.now();
await transcriber.warmUp();
console.log(`model ready in ${((Date.now() - t) / 1000).toFixed(1)} s`);
t = Date.now();
const text = await transcriber.transcribe(samples);
console.log(`"${text}" in ${((Date.now() - t) / 1000).toFixed(1)} s for ${(samples.length / rate).toFixed(1)} s of audio`);
