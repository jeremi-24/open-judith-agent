import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWindowsLink, mergeApps, normalize, rankApps } from '../src/core/apps.js';

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

test('Store apps join the shortcuts, a shortcut wins a tie', () => {
  const merged = mergeApps(
    [{ name: 'VLC media player', path: 'vlc.lnk' }],
    [{ name: 'Paramètres', appId: 'windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel' }, { name: 'VLC media player', appId: 'x' }],
  );
  assert.deepEqual(merged.map((a) => a.name), ['VLC media player', 'Paramètres']);
  assert.equal(rankApps(merged, 'parametres')[0].name, 'Paramètres');
});

test('Windows settings pages open like links, paths and URLs do not', () => {
  assert.ok(isWindowsLink('ms-settings:bluetooth'));
  assert.ok(isWindowsLink('ms-settings:connecteddevices'));
  assert.ok(isWindowsLink('shell:Downloads'));
  assert.ok(!isWindowsLink('C:\Windows'));
  assert.ok(!isWindowsLink('https://example.com'));
  assert.ok(!isWindowsLink('ms-settings:x & calc'));
});
