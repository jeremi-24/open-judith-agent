import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createVisualStore, FIT, resolveFrame, SCENE_CSP, VISUAL_CSP } from '../src/main/frames.js';

const root = join(import.meta.dirname, '..');

test('visuals: served with their own CSP and the height script, the oldest forgotten', () => {
  const visuals = createVisualStore(2);
  const first = visuals.add('<p>un</p>');
  const second = visuals.add('<p>deux</p>');
  assert.equal(second, 'judith-frame://visual/2');
  const found = resolveFrame(second, { root, visuals });
  assert.equal(found.status, 200);
  assert.equal(found.csp, VISUAL_CSP);
  assert.equal(found.body, `<p>deux</p>${FIT}`);
  assert.doesNotMatch(VISUAL_CSP, /connect-src|https?:/);
  visuals.add('<p>trois</p>');
  assert.equal(resolveFrame(first, { root, visuals }).status, 404);
});

test('scene: only the fixed files, which exist', () => {
  const visuals = createVisualStore();
  for (const name of ['scene.html', 'scene-boot.js', 'scene-bricks.js', 'scene-runtime.js', 'three.min.js']) {
    const found = resolveFrame(`judith-frame://scene/${name}`, { root, visuals });
    assert.equal(found.status, 200, name);
    assert.equal(found.csp, SCENE_CSP);
    assert.ok(existsSync(found.file), found.file);
  }
});

test('nothing else answers: no path from the request reaches the disk', () => {
  const visuals = createVisualStore();
  for (const url of [
    'judith-frame://scene/../../package.json',
    'judith-frame://scene/%2e%2e/main/main.js',
    'judith-frame://scene/constructor',
    'judith-frame://scene/',
    'judith-frame://other/scene.html',
    'judith-frame://visual/99',
    'file:///etc/passwd',
    'not a url',
  ]) {
    assert.notEqual(resolveFrame(url, { root, visuals }).status, 200, url);
  }
});
