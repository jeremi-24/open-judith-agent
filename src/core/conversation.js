// The conversation manager: the one place that decides who talks and when.
//
//   idle ──summon──▶ listening ──heard──▶ thinking ──1st sentence──▶ speaking
//     ▲                 │  ▲                  │                          │
//     │       nothing   │  └── follow-up ◀────┴──── answer done, voice idle
//     └────── cancel (X, Esc) from anywhere ─────────────────────────────┘
//            interrupt (the user talks over Judith) ──▶ listening
//
// The microphone, Whisper/Deepgram, Claude Code and the voice never decide
// anything: they report events here and execute the effects they are given.
// Each question gets a turn number; late events from a cancelled turn are
// ignored. That is what prevents loops, double answers and mic/voice fights.
import { t } from './i18n.js';
import { isGoodbye, isIncomplete } from './turn.js';

// fx = {
//   listen({ followUp, continuation, bargeIn }) / finishListening() / stopListening()
//   ask(text, turn) / cancelAsk(turn)
//   stopVoice() / voiceBusy()
//   watchForInterruptions(on)   mic watch while Judith speaks
//   clearScreen()
//   ui(state, info)
//   later(fn, ms) → cancel()
// }
export function createConversation(fx, options = {}) {
  const opts = { conversation: true, interruptions: true, followUpDelayMs: 800, ...options };
  let state = 'idle';
  let turn = 0;
  let answerDone = false;
  let prefix = ''; // the start of an unfinished sentence
  let pending = null; // a scheduled follow-up listening

  function set(next, info = {}) {
    state = next;
    fx.watchForInterruptions(next === 'speaking' && opts.interruptions);
    fx.ui(next, info);
  }

  function unschedule() {
    pending?.();
    pending = null;
  }

  function listen(info = {}) {
    unschedule();
    set('listening', info);
    fx.listen(info);
  }

  function think(text, shown = text) {
    prefix = '';
    turn += 1;
    answerDone = false;
    set('thinking', { heard: shown });
    fx.ask(text, turn);
  }

  // After the answer: listen again (a real conversation), or rest.
  function maybeNext() {
    if ((state !== 'thinking' && state !== 'speaking') || !answerDone || fx.voiceBusy()) return;
    answerDone = false;
    if (!opts.conversation) return set('idle');
    set('speaking', { done: true });
    fx.watchForInterruptions(false);
    pending = fx.later(() => {
      pending = null;
      if (state === 'speaking') listen({ followUp: true });
    }, opts.followUpDelayMs);
  }

  // Stop everything that runs for the current turn.
  function stopAll() {
    unschedule();
    fx.stopListening();
    fx.stopVoice();
    if (state === 'thinking' || state === 'speaking') fx.cancelAsk(turn);
    turn += 1; // whatever this turn still sends is now ignored
    prefix = '';
  }

  return {
    get state() {
      return state;
    },
    get turn() {
      return turn;
    },

    // Settings sent by the app (conversation mode, interruptions).
    configure(next = {}) {
      for (const key of ['conversation', 'interruptions']) if (typeof next[key] === 'boolean') opts[key] = next[key];
    },

    // Shortcut or click on the idle notch.
    summon() {
      if (state === 'listening') return fx.finishListening(); // "I'm done talking"
      if (state === 'thinking' || state === 'speaking') return this.interrupt();
      prefix = '';
      listen();
    },

    // At rest, the user started talking to her (words already recognised):
    // keep them and listen for the rest of the sentence.
    overheard(text) {
      const said = String(text ?? '').trim();
      if (state !== 'idle' || !said) return false;
      if (isGoodbye(said)) {
        fx.clearScreen();
        set('idle', { message: t('À plus !') });
        return true;
      }
      prefix = said;
      listen({ continuation: true, partial: said });
      return true;
    },

    // A question typed in the notch.
    typed(text) {
      const said = String(text ?? '').trim();
      if (!said) return;
      if (state === 'thinking' || state === 'speaking') stopAll();
      fx.stopListening();
      think(said);
    },

    // Agent mode: the user did the step, Judith asks herself the next one.
    // Never over Judith (thinking, speaking): → false, nothing done.
    continueWith(text, shown) {
      // (speaking with a follow-up pending: the answer is over, she is silent)
      if (state === 'thinking' || (state === 'speaking' && !pending)) return false;
      unschedule();
      fx.stopListening();
      think(text, shown);
      return true;
    },

    // The ears finished: text heard ('' when nothing).
    heard(text, { followUp = false, bargeIn = false } = {}) {
      if (state !== 'listening') return;
      const full = [prefix, String(text ?? '').trim()].filter(Boolean).join(' ');
      if (!text) {
        if (prefix) return think(prefix);
        return set('idle', followUp ? {} : { message: t("Je n'ai rien entendu.") });
      }
      // "Arrête.", "Allez, salut." after an answer or over Judith's voice: the
      // conversation is over, nothing to ask. (Right after the shortcut,
      // "Salut" is a hello.)
      if ((followUp || bargeIn) && isGoodbye(full)) {
        fx.clearScreen();
        return set('idle', { message: t('À plus !') });
      }
      // A pause in the middle of a sentence: keep listening for the rest, once.
      if (isIncomplete(full) && !prefix) {
        prefix = full;
        fx.ui('listening', { partial: full });
        return fx.listen({ continuation: true });
      }
      think(full);
    },

    // The voice started a sentence of this turn.
    sentence(t) {
      if (t !== turn || state === 'idle' || state === 'listening') return false;
      if (state !== 'speaking') set('speaking');
      return true;
    },

    // Claude Code finished this turn.
    answered(t) {
      if (t !== turn) return;
      answerDone = true;
      maybeNext();
    },

    // The voice has nothing left to say.
    voiceIdle() {
      maybeNext();
    },

    failed(t, message) {
      if (t !== turn) return;
      fx.stopVoice();
      set('idle', { error: message });
    },

    // The user talks over Judith (or presses the shortcut while she answers).
    interrupt() {
      if (state !== 'thinking' && state !== 'speaking') return;
      stopAll();
      listen({ bargeIn: true });
    },

    // X, Esc: stop everything, whoever is talking.
    cancel() {
      if (state === 'idle') return;
      stopAll();
      fx.clearScreen();
      set('idle');
    },
  };
}
