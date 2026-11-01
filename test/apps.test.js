import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, rankApps } from '../src/core/apps.js';

const apps = [
  { name: 'VLC media player', path: 'a' },
  { name: 'Uninstall VLC', path: 'b' },
  { name: 'Blender 5.2', path: 'c' },
  { name: 'Visual Studio Code', path: 'd' },
  { name: 'Paramètres', path: 'e' },
];

test('normalize ignores case, accents and punctuation', () => {
  assert.equal(normalize('  Paramètres-Système! '), 'parametres systeme');
});

test('the closest app comes first and uninstallers are ignored', () => {
  assert.deepEqual(rankApps(apps, 'vlc').map((a) => a.name), ['VLC media player']);
  assert.equal(rankApps(apps, 'blender')[0].name, 'Blender 5.2');
  assert.equal(rankApps(apps, 'visual studio')[0].name, 'Visual Studio Code');
  assert.equal(rankApps(apps, 'parametres')[0].name, 'Paramètres');
});

test('no match gives an empty list', () => {
  assert.deepEqual(rankApps(apps, 'photoshop'), []);
  assert.deepEqual(rankApps(apps, ''), []);
});
