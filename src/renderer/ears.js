// Judith's ears: one listening session at a time, on the shared microphone.
// Local mode: our VAD decides the end, Whisper transcribes.
// Deepgram mode: words appear live and Deepgram decides the end; the audio is
// kept too, so Whisper takes over if the network fails.
// The ears never decide what happens next: they report to the conversation.
import { closeMic, concat, onFrames, openMic, preroll, RATE } from './mic.js';
import { createVad } from '../core/vad.js';

// How strict listening is, depending on the moment.
const PROFILES = {
  normal: { endMs: 900, minSpeechMs: 300 },
  continuation: { endMs: 900, minSpeechMs: 300 },
  // After an answer, only a voice clearly addressed to Judith counts.
  followUp: { factor: 4, minLevel: 0.03, endMs: 900, minSpeechMs: 600 },
  // While Judith speaks: her own voice must not trigger it.
  watch: { factor: 4.5, minLevel: 0.035, startMs: 260, endMs: 400, minSpeechMs: 260 },
};
const NO_SPEECH_MS = { normal: 7000, continuation: 1600, followUp: 5000 };
const MAX_MS = 30000;
// Push to talk: the user ends the question (shortcut or Stop), never silence.
const PUSH_MAX_MS = 120000;
// Talking over Judith: a sound that looks like speech is transcribed for this
// long, and only real words (not music, not her own echo) interrupt her.
const CONFIRM_MS = 1200;
const words = (text) => String(text ?? '').split(/\s+/).filter((w) => /\p{L}{2,}/u.test(w)).length;

const toPcm16 = (frame) => {
  const pcm = new Int16Array(frame.length);
  for (let i = 0; i < frame.length; i++) {
    const v = Math.max(-1, Math.min(1, frame[i]));
    pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return pcm.buffer;
};

// transcribe(Float32Array) → text; filter(text, info) → text or '' (echo, phantom)
export function createEars({ transcribe, filter, onLevel = () => {}, onPartial = () => {} }) {
  let stt = null; // { provider: 'deepgram', key, model, language, keyterms } or null
  let session = null;
  let attempt = 0;
  let watcher = null;
  let push = false;

  function openDeepgram(onText, onFinal, onFail) {
    const params = new URLSearchParams({
      model: stt.model ?? 'nova-3', language: stt.language ?? 'fr',
      encoding: 'linear16', sample_rate: String(RATE), channels: '1',
      interim_results: 'true', smart_format: 'true', punctuate: 'true',
      endpointing: '300', utterance_end_ms: '1000', vad_events: 'true',
    });
    for (const term of stt.keyterms ?? []) params.append('keyterm', term);
    const socket = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, ['token', stt.key]);
    socket.binaryType = 'arraybuffer';
    const queue = [];
    let finalText = '';
    socket.onopen = () => queue.splice(0).forEach((b) => socket.send(b));
    socket.onmessage = (event) => {
      const m = JSON.parse(event.data);
      if (m.type === 'Results') {
        const text = m.channel?.alternatives?.[0]?.transcript ?? '';
        if (!text) return;
        if (m.is_final) finalText += `${finalText ? ' ' : ''}${text}`;
        onText(m.is_final ? finalText : `${finalText} ${text}`.trim());
        if (m.speech_final && finalText) onFinal(finalText);
      } else if (m.type === 'UtteranceEnd' && finalText) {
        onFinal(finalText);
      }
    };
    socket.onerror = () => onFail();
    return {
      send(frame) {
        const buffer = toPcm16(frame);
        if (socket.readyState === WebSocket.OPEN) socket.send(buffer);
        else if (socket.readyState === WebSocket.CONNECTING) queue.push(buffer);
      },
      get text() {
        return finalText;
      },
      close() {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'CloseStream' }));
        socket.close();
      },
    };
  }

  // info: { followUp, continuation, bargeIn }; onEnd(text) once, '' if nothing.
  // onStop: the user stopped talking (before the transcription).
  async function start(info, onEnd, onStop = () => {}) {
    cancel();
    const mine = ++attempt;
    await openMic();
    if (mine !== attempt) return;

    const kind = info.followUp ? 'followUp' : info.continuation ? 'continuation' : 'normal';
    const vad = createVad(PROFILES[kind]);
    const startedAt = performance.now();
    // An interruption starts mid-sentence: keep what was said just before.
    const chunks = info.bargeIn ? [preroll()] : [];
    let spoke = Boolean(info.bargeIn);
    let deepgram = null;
    let done = false;

    const finish = async (useWhisper = !deepgram) => {
      if (done) return;
      done = true;
      onStop();
      unsubscribe();
      const live = deepgram;
      deepgram = null;
      live?.close();
      if (!spoke) return onEnd('');
      let text = useWhisper ? '' : live?.text ?? '';
      if (!text) {
        try {
          text = await transcribe(concat(chunks));
        } catch {
          text = '';
        }
      }
      onEnd(await filter(text, info));
    };

    if (stt?.provider === 'deepgram' && stt.key) {
      deepgram = openDeepgram(
        (text) => onPartial(text),
        () => !push && finish(false),
        () => {
          // Network problem: Whisper takes over with the audio kept so far.
          deepgram = null;
        },
      );
      for (const chunk of chunks) deepgram.send(chunk);
    }

    const unsubscribe = onFrames((frame, level, ms) => {
      if (done) return;
      onLevel(level);
      chunks.push(frame);
      deepgram?.send(frame);
      const event = vad.push(level, ms);
      if (event === 'start') spoke = true;
      // Local mode ends on our VAD; Deepgram ends on its own detection.
      const elapsed = performance.now() - startedAt;
      if (push) {
        if (elapsed > PUSH_MAX_MS) finish();
        return;
      }
      if (event === 'end' && !deepgram) finish(true);
      if ((!spoke && elapsed > NO_SPEECH_MS[kind]) || elapsed > MAX_MS) finish();
    });

    session = { finish, cancel: () => ((done = true), unsubscribe(), deepgram?.close()) };
  }

  function cancel() {
    attempt += 1;
    session?.cancel();
    session = null;
  }

  // While Judith speaks: tell when the user starts talking over her.
  async function watch(on, onSpeech) {
    watcher?.();
    watcher = null;
    if (!on) return;
    try {
      await openMic();
    } catch {
      return;
    }
    let vad = createVad(PROFILES.watch);
    let heard = null; // frames since a sound that looks like speech
    let heardMs = 0;
    let checking = false;
    const confirm = async () => {
      checking = true;
      const audio = concat(heard);
      heard = null;
      let text = '';
      try {
        text = await filter(await transcribe(audio), { bargeIn: true });
      } catch {}
      checking = false;
      vad = createVad(PROFILES.watch);
      if (watcher && words(text) >= 2) onSpeech(text);
    };
    watcher = onFrames((frame, level, ms) => {
      if (checking) return;
      if (heard) {
        heard.push(frame);
        heardMs += ms;
        if (heardMs >= CONFIRM_MS) confirm();
        return;
      }
      if (vad.push(level, ms) === 'start') {
        heard = [preroll(), frame];
        heardMs = 0;
      }
    });
  }

  return {
    configure(next) {
      stt = next ?? null;
    },
    // Push to talk on or off (noisy places).
    setPush(on) {
      push = Boolean(on);
    },
    start,
    finish: () => session?.finish(),
    cancel,
    watch,
    // End of the conversation: release the microphone.
    close() {
      cancel();
      watcher?.();
      watcher = null;
      closeMic();
    },
  };
}
