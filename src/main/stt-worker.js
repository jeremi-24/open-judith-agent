// Whisper runs in a worker thread so the app never freezes while it listens.
import { parentPort, workerData } from 'node:worker_threads';
import { createTranscriber } from '../engine/speech-to-text.js';

const transcriber = createTranscriber(workerData);
transcriber
  .warmUp()
  .then(() => parentPort.postMessage({ ready: true }))
  .catch((error) => parentPort.postMessage({ ready: false, error: error.message }));

parentPort.on('message', async ({ id, audio }) => {
  try {
    parentPort.postMessage({ id, text: await transcriber.transcribe(audio) });
  } catch (error) {
    parentPort.postMessage({ id, error: error.message });
  }
});
