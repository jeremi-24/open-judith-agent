import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runActions } from '../src/core/pilot.js';

const chrome = { process: 'chrome', title: 'Google Chrome' };
// A fake computer: where things land, what the user answers, what was done.
function computer({ controls = {}, app = chrome, answer = true, user = false } = {}) {
  const log = [];
  return {
    log,
    fx: {
      locate: async (a) => ({ app, control: a.action === 'click' ? (controls[a.label] ?? null) : null, onJudith: a.label === 'Judith' }),
      confirm: async (reason) => (log.push(['confirm', reason]), answer),
      show: async (a) => log.push(['show', a.action]),
      perform: async (a) => (log.push(['do', a.action, a.label ?? a.text ?? a.combo]), user ? { error: 'user' } : { ok: true }),
    },
  };
}
const click = (label) => ({ action: 'click', x: 0.5, y: 0.5, button: 'left', label });

test('ordinary actions are shown, then done, in order', async () => {
  const { fx, log } = computer({ controls: { Rechercher: { name: 'Rechercher', type: 'Edit' } } });
  const state = { count: 0, lastControl: null };
  const result = await runActions([click('Rechercher'), { action: 'type', text: 'chat' }, { action: 'key', combo: 'enter' }], fx, state);
  assert.deepEqual(result, { done: 3 });
  assert.deepEqual(log, [['show', 'click'], ['do', 'click', 'Rechercher'], ['show', 'type'], ['do', 'type', 'chat'], ['show', 'key'], ['do', 'key', 'enter']]);
  assert.equal(state.count, 3);
});

test('a sensitive click waits for "Vas-y"; "Non" stops the step before anything', async () => {
  const yes = computer({ controls: { Supprimer: { name: 'Supprimer', type: 'Button' } } });
  assert.deepEqual(await runActions([click('Supprimer')], yes.fx), { done: 1 });
  assert.deepEqual(yes.log[0], ['confirm', 'Cliquer sur « Supprimer » ?']);

  const no = computer({ controls: { Supprimer: { name: 'Supprimer', type: 'Button' } }, answer: false });
  const result = await runActions([click('Supprimer'), click('Autre')], no.fx);
  assert.equal(result.stopped, 'declined');
  assert.ok(!no.log.some(([kind]) => kind === 'do'), 'nothing done');
});

test('typing into the password field Judith just clicked is refused', async () => {
  const { fx, log } = computer({ controls: { Champ: { name: 'Mot de passe', type: 'Edit' } } });
  const result = await runActions([click('Champ'), { action: 'type', text: 'hunter2' }], fx);
  assert.equal(result.stopped, 'blocked');
  assert.deepEqual(log.filter(([k]) => k === 'do'), [['do', 'click', 'Champ']]);
});

test('blocked apps and Judith herself: nothing happens', async () => {
  const terminal = computer({ app: { process: 'WindowsTerminal', title: '' } });
  assert.equal((await runActions([{ action: 'key', combo: 'enter' }], terminal.fx)).stopped, 'blocked');
  assert.equal(terminal.log.length, 0);
  const self = computer({ controls: { Judith: { name: 'Vas-y', type: 'Button' } } });
  assert.equal((await runActions([click('Judith')], self.fx)).stopped, 'blocked');
});

test('the user moves the mouse: everything stops', async () => {
  const { fx } = computer({ controls: { A: { name: 'A', type: 'Button' } }, user: true });
  const result = await runActions([click('A'), click('A')], fx);
  assert.equal(result.stopped, 'user');
  assert.equal(result.done, 0);
});

test('at most 3 actions per step', async () => {
  const { fx, log } = computer({ controls: { A: { name: 'A', type: 'Button' } } });
  await runActions([click('A'), click('A'), click('A'), click('A'), click('A')], fx);
  assert.equal(log.filter(([k]) => k === 'do').length, 3);
});
