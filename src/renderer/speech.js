// Judith's voice. Each sentence is synthesized ahead by the neural voice
// (main process) and played in order; Windows voices are the fallback.
// say(text, onStart): onStart runs when that sentence starts playing, which is
// how drawings appear exactly when Judith talks about them.
window.JudithVoice = (() => {
  const synth = window.speechSynthesis;
  const PREFERRED = ['Julie', 'Hortense', 'Denise', 'Paul'];
  let windowsVoice = null;
  let enabled = true;
  let onIdle = () => {};

  const queue = [];
  let playing = false;
  let generation = 0;
  let context = null;
  let current = null;
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

  async function playSamples({ samples, sampleRate }) {
    context ??= new AudioContext();
    if (context.state === 'suspended' && !paused) await context.resume();
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
      const { sentence, audio, onStart } = queue.shift();
      const samples = await audio;
      if (mine !== generation) break;
      onStart();
      await (samples ? playSamples(samples) : playWindows(sentence));
    }
    playing = false;
    current = null;
    if (mine === generation) onIdle();
  }

  function say(sentence, onStart = () => {}) {
    if (!enabled) {
      onStart();
      return;
    }
    // A failed synthesis falls back to the Windows voice for that sentence.
    queue.push({ sentence, onStart, audio: window.judith.speak(plain(sentence)).catch(() => null) });
    drain();
  }

  function stop() {
    generation++;
    queue.length = 0;
    synth.cancel();
    try {
      current?.stop();
    } catch {}
    current = null;
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
    onIdle(handler) {
      onIdle = handler;
    },
  };
})();
