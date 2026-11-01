import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addReminder, describeWhen, dueReminders, parseWhen } from '../src/core/reminders.js';

const NOW = new Date(2026, 10, 1, 15, 30); // 1 Nov 2026, 15:30 local

test('a time is today, or tomorrow when already past', () => {
  assert.deepEqual([parseWhen('17:00', NOW).getDate(), parseWhen('17:00', NOW).getHours()], [1, 17]);
  assert.deepEqual([parseWhen('17h30', NOW).getHours(), parseWhen('17h30', NOW).getMinutes()], [17, 30]);
  assert.equal(parseWhen('8h', NOW).getDate(), 2);
  assert.equal(parseWhen('2026-11-03T09:15', NOW).getDate(), 3);
  assert.equal(parseWhen('25:00', NOW), null);
  assert.equal(parseWhen('demain', NOW), null);
});

test('reminders are added in order, refused when past or nonsense', () => {
  let { list } = addReminder([], { when: '18:00', text: 'Appeler maman' }, NOW);
  ({ list } = addReminder(list, { when: '17:00', text: 'Pause' }, NOW));
  assert.deepEqual(list.map((r) => r.text), ['Pause', 'Appeler maman']);
  assert.ok(addReminder([], { when: '2026-10-01T10:00' }, NOW).error);
  assert.ok(addReminder([], { when: 'bientôt' }, NOW).error);
});

test('due reminders come out, a missed one too', () => {
  const { list } = addReminder([], { when: '15:45', text: 'Thé' }, NOW);
  assert.equal(dueReminders(list, NOW).due.length, 0);
  const later = new Date(2026, 10, 1, 16, 10); // Judith was off at 15:45
  assert.deepEqual(dueReminders(list, later).due.map((r) => r.text), ['Thé']);
  assert.equal(dueReminders(list, later).rest.length, 0);
});

test('Judith says when in plain French', () => {
  assert.equal(describeWhen(parseWhen('17:00', NOW), NOW), 'à 17:00');
  assert.equal(describeWhen(parseWhen('8h30', NOW), NOW), 'demain à 08:30');
});
