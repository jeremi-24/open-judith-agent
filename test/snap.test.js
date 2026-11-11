import assert from 'node:assert/strict';
import test from 'node:test';
import { markBox, nameScore, normalize, pickSnap, snapMark } from '../src/core/snap.js';

const rect = (x1, y1, x2, y2) => ({ x1, y1, x2, y2 });
const el = (name, type, r) => ({ name, type, rect: r });

test('names are compared without accents, case or punctuation', () => {
  assert.equal(normalize('Exporter…'), 'exporter');
  assert.equal(nameScore('Exporter', 'exporter'), 1);
  assert.equal(nameScore('Tableau croisé', 'Insérer un tableau croisé dynamique'), 0.6);
  assert.equal(nameScore('Export', 'Fichier'), 0);
  assert.equal(nameScore('', 'Fichier'), 0);
});

test('a box ~30 px off snaps onto the real button', () => {
  // On a 1920x1080 display: the model's box is 30 px left and 10 px up.
  const model = rect(0.86, 0.03, 0.92, 0.07);
  const button = rect(0.875, 0.04, 0.935, 0.08);
  const got = pickSnap(model, 'Exporter', [
    el('', 'Pane', rect(0, 0, 1, 1)),
    el('Barre d’outils', 'ToolBar', rect(0.5, 0.02, 1, 0.1)),
    el('Exporter', 'Button', button),
  ]);
  assert.deepEqual(got, button);
});

test('the right name wins over a bigger overlap', () => {
  const model = rect(0.4, 0.4, 0.5, 0.45);
  const wrong = rect(0.4, 0.4, 0.5, 0.45);
  const right = rect(0.43, 0.41, 0.49, 0.44);
  assert.deepEqual(pickSnap(model, 'Valeurs', [el('Lignes', 'Text', wrong), el('Valeurs', 'Text', right)]), right);
});

test('windows, panes and far elements are never chosen', () => {
  const model = rect(0.2, 0.2, 0.25, 0.23);
  assert.equal(pickSnap(model, 'Ok', [el('Fenêtre', 'Window', rect(0, 0, 1, 1))]), null);
  assert.equal(pickSnap(model, 'Ok', [el('Ok', 'Button', rect(0.6, 0.6, 0.65, 0.63))]), null);
  assert.equal(pickSnap(model, 'Ok', []), null);
  assert.equal(pickSnap(model, 'Ok', undefined), null);
});

test('a different element of another size without the label is not taken', () => {
  const model = rect(0.3, 0.3, 0.32, 0.32); // a tiny icon
  const big = rect(0.25, 0.28, 0.45, 0.4); // a large list around it, no name match
  assert.equal(pickSnap(model, 'Corbeille', [el('Liste', 'List', big)]), null);
});

test('a tiny icon whose centre is just off the model still snaps', () => {
  const model = rect(0.5, 0.95, 0.515, 0.975);
  const icon = rect(0.517, 0.952, 0.532, 0.98);
  assert.deepEqual(pickSnap(model, 'Wi-Fi', [el('Wi-Fi', 'Button', icon)]), icon);
});

test('snapMark keeps the shape and label, takes the real bounds', () => {
  const mark = { type: 'mark', shape: 'box', x: 0.5, y: 0.5, w: 0.1, h: 0.1, label: 'A' };
  assert.deepEqual(markBox(mark), rect(0.45, 0.45, 0.55, 0.55));
  const snapped = snapMark(mark, rect(0.4, 0.4, 0.6, 0.5));
  assert.equal(snapped.shape, 'box');
  assert.equal(snapped.label, 'A');
  assert.ok(Math.abs(snapped.x - 0.5) < 1e-9 && Math.abs(snapped.y - 0.45) < 1e-9);
  assert.ok(Math.abs(snapped.w - 0.2) < 1e-9 && Math.abs(snapped.h - 0.1) < 1e-9);
  assert.equal(snapped.snapped, true);
  assert.equal(snapMark(mark, null), mark);
});
