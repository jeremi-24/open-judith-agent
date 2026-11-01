import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLineParser } from '../src/core/stream.js';

test('parses objects split across chunks', () => {
  const seen = [];
  const push = createLineParser((o) => seen.push(o));
  push('{"type":"sys');
  push('tem"}\n{"type":"result"');
  push(',"ok":true}\n');
  assert.deepEqual(seen, [{ type: 'system' }, { type: 'result', ok: true }]);
});

test('reports lines that are not JSON', () => {
  const bad = [];
  const push = createLineParser(() => {}, (l) => bad.push(l));
  push('warning: something\n\n{"a":1}\n');
  assert.deepEqual(bad, ['warning: something']);
});
