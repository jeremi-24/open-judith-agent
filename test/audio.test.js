import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeWav, fixName } from '../src/core/audio.js';

test('fixName restores Judith from Whisper spellings', () => {
  assert.equal(fixName(" J'udite, ouvre VLC."), 'Judith, ouvre VLC.');
  assert.equal(fixName('Judite ouvre VLC'), 'Judith ouvre VLC');
  assert.equal(fixName('Dis Judit, aide-moi'), 'Dis Judith, aide-moi');
  assert.equal(fixName('juridique'), 'juridique');
});

test('decodeWav reads 16-bit mono PCM', () => {
  const samples = [0, 16384, -32768];
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(s, i * 2));
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(1, 2);
  fmt.writeUInt32LE(16000, 4);
  fmt.writeUInt32LE(32000, 8);
  fmt.writeUInt16LE(2, 12);
  fmt.writeUInt16LE(16, 14);
  const chunk = (id, body) => Buffer.concat([Buffer.from(id), Buffer.from(new Uint32Array([body.length]).buffer), body]);
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), chunk('fmt ', fmt), chunk('data', data)]);

  const { samples: out, rate } = decodeWav(wav);
  assert.equal(rate, 16000);
  assert.deepEqual([...out], [0, 0.5, -1]);
});

test('decodeWav trusts the bytes when a streamed WAV announces a wrong size', () => {
  const data = Buffer.alloc(4);
  data.writeInt16LE(16384, 0);
  data.writeInt16LE(-16384, 2);
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0); fmt.writeUInt16LE(1, 2); fmt.writeUInt32LE(44100, 4);
  fmt.writeUInt32LE(88200, 8); fmt.writeUInt16LE(2, 12); fmt.writeUInt16LE(16, 14);
  const head = (id, size) => Buffer.concat([Buffer.from(id), Buffer.from(new Uint32Array([size]).buffer)]);
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), head('fmt ', 16), fmt, head('data', 0xffffffff), data]);
  const { samples, rate } = decodeWav(wav);
  assert.equal(rate, 44100);
  assert.deepEqual([...samples], [0.5, -0.5]);
});
