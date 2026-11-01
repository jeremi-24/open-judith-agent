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
