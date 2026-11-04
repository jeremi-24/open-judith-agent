import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHands } from '../src/main/hands.js';

// A stand-in for judith-hands.exe: same line protocol, same "user" safety.
const fake = `
let last = null, stopped = false;
require('readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const [cmd, id, ...args] = line.split(' ');
  const reply = (o) => console.log(JSON.stringify({ id, ...o }));
  if (cmd === 'reset') { stopped = false; return reply({ ok: true }); }
  if (cmd === 'at' || cmd === 'fg') return reply({ process: 'chrome', title: 'T ' + args.join(',') });
  if (stopped) return reply({ error: 'user' });
  reply({ ok: true, echo: [cmd, ...args].join(' ') });
});`;

test('commands, the typed text in base64, and the "user" safety until reset', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'judith-hands-')), 'hands.cjs');
  writeFileSync(file, fake);
  const hands = createHands({ exe: process.execPath, args: [file] });
  assert.deepEqual(await hands.at(10.4, 20.6), { id: '1', process: 'chrome', title: 'T 10,21' });
  assert.equal((await hands.click(5, 6, 'double')).echo, 'click 5 6 double');
  assert.equal((await hands.click(5, 6, 'middle; rm')).echo, 'click 5 6 left');
  const typed = await hands.type('héllo | x\nok');
  assert.equal(Buffer.from(typed.echo.split(' ')[1], 'base64').toString('utf8'), 'héllo | x\nok');
  assert.equal((await hands.key('Ctrl + S')).echo, 'key ctrl+s');
  hands.stop();
});

test('without the companion: every action fails, nothing is attempted', async () => {
  const hands = createHands({ exe: null });
  assert.equal(hands.available, false);
  assert.deepEqual(await hands.click(1, 1), { error: 'unavailable' });
});
