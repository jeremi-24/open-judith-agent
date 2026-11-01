// One microphone for the whole conversation, shared by everything that needs
// it (listening, interruption watch). It keeps the last second of audio, so
// the first words of an interruption are not lost.
export const RATE = 16000;
const FRAME = 1024; // 64 ms at 16 kHz
const FRAME_MS = (FRAME / RATE) * 1000;
const PREROLL_MS = 1200;

let mic = null;
let opening = null;
const listeners = new Set();
const ring = [];

export function openMic() {
  if (mic) return Promise.resolve();
  opening ??= (async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const context = new AudioContext({ sampleRate: RATE });
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(FRAME, 1, 1);
    processor.onaudioprocess = (event) => {
      const data = new Float32Array(event.inputBuffer.getChannelData(0));
      let sum = 0;
      for (const v of data) sum += v * v;
      const level = Math.sqrt(sum / data.length);
      ring.push(data);
      while (ring.length * FRAME_MS > PREROLL_MS) ring.shift();
      for (const listener of listeners) listener(data, level, FRAME_MS);
    };
    source.connect(processor);
    processor.connect(context.destination);
    mic = { stream, context, processor };
  })().finally(() => {
    opening = null;
  });
  return opening;
}

// Released when the conversation ends: the Windows mic indicator goes off.
export function closeMic() {
  if (!mic) return;
  mic.processor.disconnect();
  mic.stream.getTracks().forEach((t) => t.stop());
  mic.context.close();
  mic = null;
  ring.length = 0;
}

// listener(frame: Float32Array, level: 0..1, ms). Returns unsubscribe.
export function onFrames(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// The last second of audio, oldest first.
export function preroll() {
  return concat(ring);
}

export function concat(chunks) {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
