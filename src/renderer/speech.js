// Judith's voice: Windows' own voices through the Web Speech API (offline).
// Sentences are spoken as soon as they are complete, while the answer streams.
window.JudithVoice = (() => {
  const synth = window.speechSynthesis;
  const PREFERRED = ['Julie', 'Hortense', 'Denise', 'Paul'];
  let voice = null;
  let spokenUpTo = 0;
  let enabled = true;
  let onSentence = () => {};
  let onIdle = () => {};

  function pickVoice(lang) {
    const voices = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang));
    voice = PREFERRED.map((name) => voices.find((v) => v.name.includes(name))).find(Boolean) ?? voices[0] ?? null;
  }
  pickVoice('fr');
  synth.addEventListener('voiceschanged', () => pickVoice('fr'));

  const plain = (text) => text.replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim();

  function say(sentence) {
    const utterance = new SpeechSynthesisUtterance(plain(sentence));
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang ?? 'fr-FR';
    utterance.rate = 1.08;
    utterance.onstart = () => onSentence(sentence);
    utterance.onend = () => {
      if (!synth.speaking && !synth.pending) onIdle();
    };
    synth.speak(utterance);
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
    synth.cancel();
    spokenUpTo = 0;
  }

  return {
    feed,
    stop,
    get enabled() {
      return enabled;
    },
    setEnabled(on) {
      enabled = on;
      if (!on) synth.cancel();
    },
    on(handlers) {
      onSentence = handlers.sentence ?? onSentence;
      onIdle = handlers.idle ?? onIdle;
    },
  };
})();
