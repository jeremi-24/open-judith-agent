// Emotion tags like "[excited]" are for a voice that can act (Fish Audio).
// Everywhere else (text in the notch, other voices) they are removed.
const TAG = /\s*\[[a-z][a-z '-]{0,30}\]\s*/gi;

export function stripEmotions(text) {
  return String(text ?? '').replace(TAG, ' ').replace(/\s{2,}/g, ' ').trim();
}
