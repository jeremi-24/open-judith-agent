import assert from 'node:assert/strict';
import test from 'node:test';
import { shortcutAction } from '../src/core/shortcut.js';

test('at rest, the shortcut summons Judith', () => {
  assert.equal(shortcutAction('none'), 'summon');
  assert.equal(shortcutAction(undefined), 'summon');
});

test('while listening, the shortcut still means "I am done talking"', () => {
  assert.equal(shortcutAction('listening'), 'summon');
});

test('while she thinks or speaks, the same shortcut cancels everything', () => {
  assert.equal(shortcutAction('thinking'), 'cancel');
  assert.equal(shortcutAction('speaking'), 'cancel');
});
