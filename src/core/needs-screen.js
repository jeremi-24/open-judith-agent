// Does the question obviously need the screen? Then the screenshot goes with
// it right away, instead of waiting for Claude to ask for it (one round trip,
// a few seconds, saved). Otherwise Claude still decides with look_at_screen.
const SCREEN_WORDS = [
  'écran', 'ecran', 'ça', 'ceci', 'cela', 'ici', 'là', 'là-bas', 'ce truc', 'cette', 'ce bouton', 'cet',
  'vois', 'voit', 'regarde', 'montre', 'montre-moi', 'où est', 'ou est', 'où se trouve', 'où je', 'clique', 'cliquer',
  'affiche', 'page', 'fenêtre', 'onglet', 'image', 'photo', 'graphique', 'tableau', 'schéma', 'erreur', 'message',
  'screen', 'this', 'that', 'here', 'where is', 'show me', 'see',
  'these', 'those', 'button', 'tab', 'window', 'chart', 'graph', 'table', 'error', 'picture', 'image', 'page', 'look', 'click', 'where',
];
const escape = (w) => w.replace(/[-]/g, '\\-');
const PATTERN = new RegExp(`(^|[\\s'’,.!?«"])(${SCREEN_WORDS.map(escape).join('|')})(?=$|[\\s'’,.!?»"])`, 'i');

export function needsScreen(question) {
  // "Ça va ?" is a greeting, not "this".
  const q = String(question ?? '').toLowerCase().replace(/\bç?a va\b|ça marche|comment ça/g, ' ');
  return PATTERN.test(q);
}
