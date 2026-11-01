import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConversation } from '../src/core/conversation.js';

// Fake components that record the effects they are asked to perform.
function setup(options) {
  const log = [];
  const timers = [];
  let voiceBusy = false;
  const fx = {
    listen: (info) => log.push(['listen', info]),
    finishListening: () => log.push(['finishListening']),
    stopListening: () => log.push(['stopListening']),
    ask: (text, turn) => log.push(['ask', text, turn]),
    cancelAsk: (turn) => log.push(['cancelAsk', turn]),
    stopVoice: () => log.push(['stopVoice']),
    voiceBusy: () => voiceBusy,
    watchForInterruptions: (on) => log.push(['watch', on]),
    clearScreen: () => log.push(['clearScreen']),
    ui: () => {},
    later: (fn) => {
      const timer = { fn, cancelled: false };
      timers.push(timer);
      return () => (timer.cancelled = true);
    },
  };
  const c = createConversation(fx, options);
  const did = (name) => log.filter((e) => e[0] === name);
  const tick = () => timers.splice(0).forEach((t) => !t.cancelled && t.fn());
  return { c, log, did, tick, setBusy: (b) => (voiceBusy = b) };
}

test('a full turn: listen, think, speak, then listen again', () => {
  const { c, did, tick, setBusy } = setup();
  c.summon();
  assert.equal(c.state, 'listening');
  c.heard('Où est le bouton Exporter ?');
  assert.equal(c.state, 'thinking');
  assert.deepEqual(did('ask')[0], ['ask', 'Où est le bouton Exporter ?', 1]);
  setBusy(true);
  assert.ok(c.sentence(1));
  assert.equal(c.state, 'speaking');
  c.answered(1);
  assert.equal(did('listen').length, 1, 'never listens while the voice is busy');
  setBusy(false);
  c.voiceIdle();
  tick();
  assert.equal(c.state, 'listening');
  assert.deepEqual(did('listen')[1][1], { followUp: true });
});

test('without conversation mode, Judith rests after answering', () => {
  const { c } = setup({ conversation: false });
  c.summon();
  c.heard('Salut');
  c.sentence(1);
  c.answered(1);
  c.voiceIdle();
  assert.equal(c.state, 'idle');
});

test('silence after an answer ends the conversation quietly', () => {
  const { c, tick } = setup();
  c.summon();
  c.heard('Salut');
  c.answered(1);
  tick();
  assert.equal(c.state, 'listening');
  c.heard('', { followUp: true });
  assert.equal(c.state, 'idle');
});

test('an unfinished sentence keeps listening, then both parts are asked together', () => {
  const { c, did } = setup();
  c.summon();
  c.heard('Ouvre VLC et');
  assert.equal(c.state, 'listening');
  assert.deepEqual(did('listen')[1][1], { continuation: true });
  c.heard('montre-moi le menu Média');
  assert.deepEqual(did('ask')[0], ['ask', 'Ouvre VLC et montre-moi le menu Média', 1]);
});

test('if nothing comes after the pause, the first part is asked anyway', () => {
  const { c, did } = setup();
  c.summon();
  c.heard('Ouvre VLC et');
  c.heard('');
  assert.deepEqual(did('ask')[0], ['ask', 'Ouvre VLC et', 1]);
});

test('X cancels everything, and late events of that turn are ignored', () => {
  const { c, did } = setup();
  c.summon();
  c.heard('Explique-moi tout');
  c.sentence(1);
  c.cancel();
  assert.equal(c.state, 'idle');
  assert.deepEqual(did('cancelAsk')[0], ['cancelAsk', 1]);
  assert.equal(did('stopVoice').length, 1);
  assert.equal(did('clearScreen').length, 1);
  // Claude Code still sends the end of the cancelled turn: nothing happens.
  assert.equal(c.sentence(1), false);
  c.answered(1);
  assert.equal(c.state, 'idle');
});

test('X while the user is talking stops listening', () => {
  const { c, did } = setup();
  c.summon();
  c.cancel();
  assert.equal(c.state, 'idle');
  assert.equal(did('stopListening').length, 1);
  assert.equal(did('cancelAsk').length, 0);
});

test('talking over Judith stops her and listens', () => {
  const { c, did } = setup();
  c.summon();
  c.heard('Raconte-moi une histoire');
  c.sentence(1);
  c.interrupt();
  assert.equal(c.state, 'listening');
  assert.deepEqual(did('cancelAsk')[0], ['cancelAsk', 1]);
  assert.deepEqual(did('listen').at(-1)[1], { bargeIn: true });
  c.heard('Non, plutôt ouvre VLC.');
  assert.deepEqual(did('ask').at(-1), ['ask', 'Non, plutôt ouvre VLC.', 3]);
});

test('the mic watches for interruptions only while Judith speaks', () => {
  const { c, log } = setup();
  c.summon();
  c.heard('Salut');
  c.sentence(1);
  const watches = log.filter((e) => e[0] === 'watch').map((e) => e[1]);
  assert.deepEqual(watches, [false, false, true]);
});

test('the shortcut while listening means "I am done talking"', () => {
  const { c, did } = setup();
  c.summon();
  c.summon();
  assert.equal(did('finishListening').length, 1);
});

test('an error ends the turn without blocking the next one', () => {
  const { c } = setup();
  c.summon();
  c.heard('Salut');
  c.failed(1, 'Claude Code stopped');
  assert.equal(c.state, 'idle');
  c.summon();
  assert.equal(c.state, 'listening');
});

test('a goodbye puts Judith to rest without asking Claude', () => {
  const { c, did } = setup();
  c.summon();
  c.heard('Allez, salut.', { followUp: true });
  assert.equal(c.state, 'idle');
  assert.equal(did('ask').length, 0);
  assert.equal(did('clearScreen').length, 1);
});

test('right after the shortcut, "Salut" is a hello, not a goodbye', () => {
  const { c, did } = setup();
  c.summon();
  c.heard('Salut');
  assert.equal(c.state, 'thinking');
  assert.equal(did('ask').length, 1);
});
