// Judith's voice. Every sentence is requested as soon as it is known and
// arrives in chunks (streamed): playback starts with the first chunk and the
// next ones are scheduled back to back, without gaps. Sentences play in order.
// say(text, onStart): onStart runs when that sentence starts playing.
// Windows voices are the fallback when no audio comes.
window.JudithVoice = (() => {
  const synth = window.speechSynthesis;
  const PREFERRED = ['Julie', 'Hortense', 'Denise', 'Paul'];
  let windowsVoice = null;
  let enabled = true;
  let onIdle = () => {};
  let gate = () => Promise.resolve(); // the notch waits for the drawing first

  const queue = [];
  const streams = new Map(); // speech id → stream
  let playing = false;
  let generation = 0;
  let context = null;
  let sources = [];
  let paused = false;

  function pickWindowsVoice(lang) {
    const voices = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang));
    windowsVoice = PREFERRED.map((name) => voices.find((v) => v.name.includes(name))).find(Boolean) ?? voices[0] ?? null;
  }
  pickWindowsVoice('fr');
  synth.addEventListener('voiceschanged', () => pickWindowsVoice('fr'));

  const plain = (text) => text.replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim();
  // Emotion tags stay for the main process (Fish acts them), never for Windows voices.
  const spoken = (text) => plain(text).replace(/\s*\[[a-z][a-z '-]{0,30}\]\s*/gi, ' ').trim();

  // ----- streams: chunks of one sentence, as they arrive -----
  function makeStream() {
    const stream = { chunks: [], done: false, wake: null };
    stream.next = (i) =>
      new Promise((resolve) => {
        const check = () => {
          if (i < stream.chunks.length) return resolve(stream.chunks[i]);
          if (stream.done) return resolve(null);
          stream.wake = check;
        };
        check();
      });
    return stream;
  }

  window.judith.on('speech', ({ id, samples, sampleRate, done }) => {
    const stream = streams.get(id);
    if (!stream) return;
    if (samples) stream.chunks.push({ samples, sampleRate });
    if (done) {
      stream.done = true;
      streams.delete(id);
    }
    const wake = stream.wake;
    stream.wake = null;
    wake?.();
  });

  function request(sentence) {
    const stream = makeStream();
    window.judith
      .speakStart(plain(sentence))
      .then((id) => streams.set(id, stream))
      .catch(() => {
        stream.done = true;
        stream.wake?.();
      });
    return stream;
  }

  // ----- playback -----
  async function playStream(stream, first, mine) {
    context ??= new AudioContext();
    if (context.state === 'suspended' && !paused) await context.resume();
    let at = context.currentTime + 0.03;
    let last = null;
    for (let i = 0, chunk = first; chunk && mine === generation; chunk = await stream.next(++i)) {
      const buffer = context.createBuffer(1, chunk.samples.length, chunk.sampleRate);
      buffer.copyToChannel(chunk.samples, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      // A chunk that arrives late starts right away; otherwise right after the previous one.
      at = Math.max(at, context.currentTime);
      source.start(at);
      at += buffer.duration;
      sources.push(source);
      last = source;
    }
    if (last && mine === generation) await new Promise((resolve) => (last.onended = resolve));
    sources = [];
  }

  function playWindows(sentence) {
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(spoken(sentence));
      if (windowsVoice) utterance.voice = windowsVoice;
      utterance.lang = windowsVoice?.lang ?? 'fr-FR';
      utterance.rate = 1.08;
      utterance.onend = resolve;
      utterance.onerror = resolve;
      synth.speak(utterance);
    });
  }

  async function drain() {
    if (playing) return;
    playing = true;
    const mine = generation;
    while (queue.length && mine === generation) {
      const { sentence, stream, onStart } = queue.shift();
      const first = await stream.next(0);
      if (mine !== generation) break;
      await gate();
      if (mine !== generation) break;
      onStart();
      await (first ? playStream(stream, first, mine) : playWindows(sentence));
    }
    playing = false;
    if (mine === generation) onIdle();
  }

  function say(sentence, onStart = () => {}) {
    if (!enabled) {
      onStart();
      return;
    }
    queue.push({ sentence, onStart, stream: request(sentence) });
    drain();
  }

  function stop() {
    generation++;
    queue.length = 0;
    streams.clear();
    synth.cancel();
    for (const source of sources) {
      try {
        source.stop();
      } catch {}
    }
    sources = [];
    playing = false;
    setPaused(false);
  }

  function setPaused(on) {
    paused = on;
    if (on) {
      context?.suspend();
      synth.pause();
    } else {
      context?.resume();
      synth.resume();
    }
  }

  return {
    say,
    stop,
    get enabled() {
      return enabled;
    },
    get speaking() {
      return playing;
    },
    get paused() {
      return paused;
    },
    setEnabled(on) {
      enabled = on;
      if (!on) stop();
    },
    setPaused,
    setGate(fn) {
      gate = fn;
    },
    onIdle(handler) {
      onIdle = handler;
    },
  };
})();
