import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsScreen } from '../src/core/needs-screen.js';

test('questions about the screen take the screenshot right away', () => {
  for (const q of ["C'est quoi ça ?", "Explique-moi la comparaison que tu vois sur l'écran.", 'Où est le bouton Exporter ?', 'Montre-moi comment faire', 'Que veut dire cette erreur ?', 'What is this?']) {
    assert.ok(needsScreen(q), q);
  }
});

test('general questions and simple actions do not', () => {
  for (const q of ["C'est quoi une API ?", 'Ouvre VLC', 'Salut Judith, ça va ?', 'Donne-moi une idée de dîner']) {
    assert.ok(!needsScreen(q), q);
  }
});
