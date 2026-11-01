// Whisper "hears" these in silence or noise (it learned them from subtitles).
// A follow-up question made only of one of them is ignored.
const GHOSTS = [
  /^merci( beaucoup)?( à tous)?[\s.!]*$/i,
  /^sous-titr/i,
  /^[.…\s-]+$/,
  /^(bon|ok|oui|non|euh|hum|ah)[\s.!?]*$/i,
  /^thanks? (for watching|you)[\s.!]*$/i,
  /amara\.org/i,
  /^(au revoir|à bientôt|bonne soirée|bonne journée)[\s.!]*$/i,
];

export function isGhost(text) {
  const t = String(text ?? '').trim();
  return !t || GHOSTS.some((re) => re.test(t));
}

// Did the microphone just hear Judith herself (speakers into mic)?
// True when most words of what was heard are words she just said.
export function isEcho(heard, spoken) {
  const words = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]{3,}/g) ?? [];
  const said = new Set(words(spoken));
  const got = words(heard);
  if (!got.length || !said.size) return false;
  return got.filter((w) => said.has(w)).length / got.length >= 0.5;
}
