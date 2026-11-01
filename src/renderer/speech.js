// Judith's voice. Sentences are spoken as soon as they are complete, while
// the answer streams. Each one is synthesized ahead by the neural voice
// (main process) and played in order; Windows voices are the fallback.
window.JudithVoice = (() => {
  const synth = window.speechSynthesis;
  const PREFERRED = ['Julie', 'Hortense', 'Denise', 'Paul'];
  let windowsVoice = null;
  let spokenUpTo = 0;
  let enabled = true;
  let onSentence = () => {};
  let onIdle = () => {};

  // Playback queue: [{ sentence, audio: Promise<{samples, sampleRate} | null> }]
  const queue = [];
  let playing = false;
  let generation = 0;
  let context = null;
  let current = null;

  function pickWindowsVoice(lang) {
    const voices = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang));
    windowsVoice = PREFERRED.map((name) => voices.find((v) => v.name.includes(name))).find(Boolean) ?? voices[0] ?? null;
  }
  pickWindowsVoice('fr');
  synth.addEventListener('voiceschanged', () => pickWindowsVoice('fr'));

  const plain = (text) => text.replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim();

  function playSamples({ samples, sampleRate }) {
    context ??= new AudioContext();
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    current = source;
    return new Promise((resolve) => {
      source.onended = resolve;
      source.start();
    });
  }

  function playWindows(sentence) {
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(plain(sentence));
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
      const { sentence, audio } = queue.shift();
      const samples = await audio.catch(() => null);
      if (mine !== generation) break;
      onSentence(sentence);
      await (samples ? playSamples(samples) : playWindows(sentence));
    }
    playing = false;
    current = null;
    if (mine === generation) onIdle();
  }

  function say(sentence) {
    // A failed synthesis falls back to the Windows voice for that sentence.
    queue.push({ sentence, audio: window.judith.speak(plain(sentence)).catch(() => null) });
    drain();
  }

  // Speaks every complete sentence of `text` not spoken yet. With `final`,
  // the unfinished tail is spoken too.
  function feed(text, final = false) {
    if (!enabled) return;
    const rest = text.slice(spokenUpTo);
    const re = /[^.!?…]+[.!?…]+(\s|$)/g;
    let match;
    let consumed = 0;
    while ((match = re.exec(rest))) {
      say(match[0].trim());
      consumed = re.lastIndex;
    }
    spokenUpTo += consumed;
    if (final && text.slice(spokenUpTo).trim()) {
      say(text.slice(spokenUpTo).trim());
      spokenUpTo = text.length;
    }
  }

  function stop() {
    generation++;
    queue.length = 0;
    spokenUpTo = 0;
    synth.cancel();
    try {
      current?.stop();
    } catch {}
    current = null;
    playing = false;
  }

  return {
    feed,
    stop,
    get enabled() {
      return enabled;
    },
    setEnabled(on) {
      enabled = on;
      if (!on) stop();
    },
    on(handlers) {
      onSentence = handlers.sentence ?? onSentence;
      onIdle = handlers.idle ?? onIdle;
    },
  };
})();
