import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEyes } from '../src/main/eyes.js';

// A stand-in for judith-eyes.exe, speaking the same line protocol.
function fakeCompanion(body) {
  const file = join(mkdtempSync(join(tmpdir(), 'judith-eyes-')), 'eyes.cjs');
  writeFileSync(file, `const rl = require('readline').createInterface({ input: process.stdin });\nrl.on('line', (line) => { const [cmd, id, x, y] = line.split(' '); ${body} });\n`);
  return file;
}

test('around() sends a point and gets the elements back', async () => {
  const script = fakeCompanion(`console.log(JSON.stringify({ id, elements: [{ name: 'Exporter', type: 'Button', x: +x - 5, y: +y - 5, w: 10, h: 10 }] }));`);
  const eyes = createEyes({ exe: process.execPath, args: [script] });
  const elements = await eyes.around(100.4, 50.6);
  assert.deepEqual(elements, [{ name: 'Exporter', type: 'Button', x: 95, y: 46, w: 10, h: 10 }]);
  eyes.stop();
});

test('a slow or failing companion never blocks a mark', async () => {
  const silent = createEyes({ exe: process.execPath, args: [fakeCompanion('')], timeoutMs: 50 });
  assert.equal(await silent.around(1, 1), null);
  silent.stop();
  const failing = createEyes({ exe: process.execPath, args: [fakeCompanion(`console.log(JSON.stringify({ id, error: 'no element' }));`)] });
  assert.equal(await failing.around(1, 1), null);
  failing.stop();
});

test('without a companion, or after two crashes, Judith simply does without', async () => {
  const none = createEyes({ exe: null });
  assert.equal(none.available, false);
  assert.equal(await none.around(1, 1), null);
  const crashing = createEyes({ exe: process.execPath, args: ['-e', 'process.exit(3)'], timeoutMs: 2000 });
  assert.equal(await crashing.around(1, 1), null);
  assert.equal(await crashing.around(1, 1), null);
  assert.equal(crashing.available, false);
});
