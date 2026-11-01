// Records one spoken question from the microphone at 16 kHz and stops by
// itself after a short silence once the user has started talking.
window.JudithRecorder = (() => {
  const RATE = 16000;
  const SPEECH_LEVEL = 0.02; // RMS above this = someone is talking
  const END_SILENCE_MS = 1100;
  const NO_SPEECH_MS = 6000;
  const MAX_MS = 15000;

  let session = null;
  let attempt = 0; // a cancel during getUserMedia must win over the late start

  // noSpeechMs: give up after this long if nobody talks (shorter for the
  // "anything else?" listening after an answer).
  async function start({ onLevel = () => {}, onEnd = () => {}, noSpeechMs = NO_SPEECH_MS } = {}) {
    stop(true);
    const mine = ++attempt;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (mine !== attempt) {
      stream.getTracks().forEach((t) => t.stop());
      return false;
    }
    const context = new AudioContext({ sampleRate: RATE });
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(2048, 1, 1);
    const chunks = [];
    const startedAt = performance.now();
    let spokeAt = null;
    let lastVoiceAt = null;
    let voiced = 0; // frames above the speech level: a cough or a click is not a question

    session = { stream, context, processor, chunks, onEnd, done: false };

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(input));
      let sum = 0;
      for (const v of input) sum += v * v;
      const level = Math.sqrt(sum / input.length);
      onLevel(Math.min(1, level * 12));

      const now = performance.now();
      if (level > SPEECH_LEVEL) {
        spokeAt ??= now;
        lastVoiceAt = now;
        voiced += 1;
      }
      const silentTooLong = spokeAt !== null && now - lastVoiceAt > END_SILENCE_MS;
      const nobodySpoke = spokeAt === null && now - startedAt > noSpeechMs;
      // At least ~0.4 s of real voice (frames of 2048 samples = 128 ms).
      if (silentTooLong || nobodySpoke || now - startedAt > MAX_MS) finish(voiced >= 3);
    };
    source.connect(processor);
    processor.connect(context.destination);
    return true;
  }

  function collect() {
    const length = session.chunks.reduce((n, c) => n + c.length, 0);
    const audio = new Float32Array(length);
    let offset = 0;
    for (const c of session.chunks) {
      audio.set(c, offset);
      offset += c.length;
    }
    return audio;
  }

  function finish(heardSomething) {
    if (!session || session.done) return;
    session.done = true;
    const audio = heardSomething ? collect() : null;
    const { onEnd } = session;
    stop(true);
    onEnd(audio);
  }

  // silent = true: no onEnd callback (cancelled).
  function stop(silent = false) {
    if (!session) return;
    if (!silent && !session.done) return finish(true);
    session.processor.disconnect();
    session.stream.getTracks().forEach((t) => t.stop());
    session.context.close();
    session = null;
  }

  return {
    start,
    finish: () => finish(true),
    cancel() {
      attempt += 1;
      stop(true);
    },
    // Opening, or open and not finished.
    get listening() {
      return session !== null && !session.done;
    },
  };
})();
