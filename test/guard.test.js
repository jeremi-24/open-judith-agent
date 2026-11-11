import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAction, MAX_ACTIONS, normalizeKey } from '../src/core/guard.js';

const chrome = { process: 'chrome.exe', title: 'YouTube - Google Chrome' };
const button = (name) => ({ name, type: 'Button' });
const verdict = (action, context) => checkAction(action, { app: chrome, control: button('Lecture'), ...context }).verdict;

test('an ordinary click in an ordinary app: allowed', () => {
  assert.equal(verdict({ type: 'click', label: 'Lecture' }), 'allow');
  assert.equal(verdict({ type: 'scroll' }), 'allow');
  assert.equal(verdict({ type: 'type', text: 'vidéo de chat' }, { control: { name: 'Rechercher', type: 'Edit' } }), 'allow');
});

test('deleting, sending, paying, installing: ask first, on the real control name', () => {
  for (const name of ['Supprimer', 'Delete file', 'Envoyer', 'Payer maintenant', 'Acheter', 'Installer', 'Publier', 'Se déconnecter', 'Vider la corbeille', 'J’accepte']) {
    assert.equal(verdict({ type: 'click', label: 'Suivant' }, { control: button(name) }), 'confirm', name);
  }
  // The model's label alone is enough to ask, too.
  assert.equal(verdict({ type: 'click', label: 'Supprimer le dossier' }), 'confirm');
});

test('the screen cannot talk its way past the check (the real name counts)', () => {
  // The model was told by a page that "Delete account" is a harmless button.
  const result = checkAction({ type: 'click', label: 'Continuer (sans risque)' }, { app: chrome, control: button('Delete account') });
  assert.equal(result.verdict, 'confirm');
  assert.match(result.reason, /Delete account/);
});

test('without UI Automation, every click is asked', () => {
  assert.equal(verdict({ type: 'click', label: 'Lecture' }, { control: null }), 'confirm');
});

test('never in terminals, password managers, system tools, or on Judith', () => {
  for (const process of ['cmd.exe', 'powershell.exe', 'WindowsTerminal.exe', 'KeePassXC.exe', 'regedit.exe', 'Judith.exe']) {
    assert.equal(verdict({ type: 'click', label: 'OK' }, { app: { process, title: '' } }), 'block', process);
  }
  assert.equal(verdict({ type: 'click', label: 'Vas-y' }, { onJudith: true }), 'block');
  assert.equal(verdict({ type: 'click', label: 'OK' }, { app: null }), 'block');
});

test('secrets are never typed', () => {
  assert.equal(verdict({ type: 'type', text: 'hunter2' }, { control: { name: 'Mot de passe', type: 'Edit' } }), 'block');
  assert.equal(verdict({ type: 'type', text: '123456', label: 'Code de vérification' }), 'block');
  assert.equal(verdict({ type: 'type', text: '4970 1012 3456 7890' }, { control: { name: 'Note', type: 'Edit' } }), 'block');
});

test('keys: a short list only; Delete asks; Enter asks in messaging apps', () => {
  assert.equal(normalizeKey('Ctrl + S'), 'ctrl+s');
  assert.equal(verdict({ type: 'key', combo: 'Ctrl+S' }), 'allow');
  assert.equal(verdict({ type: 'key', combo: 'enter' }), 'allow');
  for (const combo of ['win+r', 'alt+f4', 'ctrl+alt+delete', 'ctrl+shift+esc', 'alt+tab']) assert.equal(verdict({ type: 'key', combo }), 'block', combo);
  assert.equal(verdict({ type: 'key', combo: 'Delete' }), 'confirm');
  assert.equal(verdict({ type: 'key', combo: 'enter' }, { app: { process: 'slack.exe', title: 'Slack' } }), 'confirm');
  assert.equal(verdict({ type: 'key', combo: 'enter' }, { app: { process: 'msedge.exe', title: 'Boîte de réception - Gmail' } }), 'confirm');
});

test('a session has a ceiling', () => {
  assert.equal(verdict({ type: 'scroll' }, { count: MAX_ACTIONS }), 'block');
});
