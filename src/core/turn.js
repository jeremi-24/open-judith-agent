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

export function isIncomplete(text) {
  const t = String(text ?? '').trim().toLowerCase();
  if (!t) return false;
  if (/[.!?]$/.test(t)) return false;
  if (/(,|…|\.\.\.|-|:)$/.test(t)) return true;
  if (/\b[ldjmtsnc]'$|\bqu'$/.test(t)) return true;
  return ENDS_WITH_WORD.test(t);
}
