// Smart end of turn: a pause does not always mean the user has finished.
// "Ouvre VLC et…", "parce que", "euh", a comma: they are still thinking.

const CONTINUES = [
  'et', 'ou', 'mais', 'donc', 'alors', 'puis', 'ensuite', 'car', 'parce que', 'comme', 'si', 'que', 'qui', 'quand',
  'pour', 'avec', 'sans', 'sur', 'dans', 'en', 'à', 'au', 'aux', 'de', 'du', 'des', 'le', 'la', 'les', 'un', 'une',
  'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses', 'ce', 'cet', 'cette', 'ces', 'est-ce que', 'genre',
  'euh', 'heu', 'hum', 'bah', 'ben', 'enfin', 'tu peux', 'je veux', 'il faut',
  'and', 'or', 'but', 'so', 'because', 'the', 'a', 'to', 'of', 'with', 'um', 'uh',
];
const ENDS_WITH_WORD = new RegExp(`(^|\\s)(${CONTINUES.map((w) => w.replace(/[-]/g, '\\-')).join('|')})$`, 'i');

// The user ends the conversation: "Arrête.", "Allez, salut.", "Merci, c'est
// bon.", "Bonsoir. Bonsoir." Only when the whole sentence is made of such
// words: "arrête de regarder en boucle" is a request, not a goodbye.
const GOODBYE_WORDS = [
  'arrête', 'arrete', 'arrêtes', 'stop', 'stoppe', 'tais-toi', 'chut', 'silence', 'laisse', 'tomber',
  'salut', 'bye', 'ciao', 'tchao', 'bonsoir', 'bonne', 'nuit', 'soirée', 'journée', 'au', 'revoir', 'à', 'plus', 'tard', 'demain',
  "c'est", 'bon', 'tout', 'fini', "j'ai", 'terminé', 'ça', 'ira', 'suffit', 'merci', 'beaucoup', 'ok', 'okay', 'd’accord', "d'accord",
  'allez', 'judith', 'non', 'rien', 'plus', 'de', 'pour', 'aujourd’hui', "aujourd'hui", 'maintenant', 'là', 'oui', 'bah', 'ben', 'euh',
  'thanks', 'thank', 'you', "that's", 'all', 'goodbye', 'bye-bye', 'see', 'later', 'enough', 'done', 'quit',
];
// At least one of these must be there: "ok, merci" alone is not a goodbye.
// (Compared word by word: \b does not know accented letters.)
const GOODBYE_CORE = [
  'arrête', 'arrete', 'arrêtes', 'stop', 'stoppe', 'tais-toi', 'chut', 'salut', 'bye', 'ciao', 'tchao', 'bonsoir', 'bonne nuit',
  'au revoir', 'à plus', "c'est bon", "c'est tout", "c'est fini", "j'ai fini", 'ça suffit', 'ça ira', 'laisse tomber',
  "that's all", 'goodbye', 'bye-bye', 'see you', 'done', 'quit',
];
const KNOWN = new Set(GOODBYE_WORDS.map((w) => w.replace(/’/g, "'")));

export function isGoodbye(text) {
  const words = String(text ?? '').toLowerCase().replace(/’/g, "'").split(/[\s,.!?;:…]+/).filter(Boolean);
  if (!words.length || words.length > 8 || !words.every((w) => KNOWN.has(w))) return false;
  const spaced = ` ${words.join(' ')} `;
  return GOODBYE_CORE.some((phrase) => spaced.includes(` ${phrase} `));
}

export function isIncomplete(text) {
  const t = String(text ?? '').trim().toLowerCase();
  if (!t) return false;
  if (/[.!?]$/.test(t)) return false;
  if (/(,|…|\.\.\.|-|:)$/.test(t)) return true;
  if (/\b[ldjmtsnc]'$|\bqu'$/.test(t)) return true;
  return ENDS_WITH_WORD.test(t);
}
