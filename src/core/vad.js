// Voice activity detection on audio levels (RMS, 0..1), adapted to the room:
// it learns the noise floor while nobody talks, and a sound counts as voice
// only when it is clearly above it, long enough.
//
// push(level, ms) returns:
//   'start'  someone started talking
//   'end'    they stopped (silence long enough) after real speech
//   'noise'  a short burst ended (cough, click): not speech
//   null     nothing new
export function createVad({
  factor = 3, // voice = level above floor × factor
  minLevel = 0.012, // never below this (silent rooms)
  maxFloor = 0.06, // a noisy room still lets a voice through
  startMs = 120, // this much voice to start
  endMs = 900, // this much silence to end
  minSpeechMs = 300, // shorter = noise
} = {}) {
  let floor = null;
  let speaking = false;
  let voicedMs = 0;
  let silentMs = 0;
  let speechMs = 0;

  const threshold = () => Math.max(minLevel, (floor ?? minLevel) * factor);

  return {
    get speaking() {
      return speaking;
    },
    get threshold() {
      return threshold();
    },
    push(level, ms) {
      const loud = level > threshold();
      // Learn the room only while it is quiet.
      if (!loud && !speaking) floor = Math.min(maxFloor, floor === null ? level : floor * 0.95 + level * 0.05);

      if (!speaking) {
        voicedMs = loud ? voicedMs + ms : Math.max(0, voicedMs - ms);
        if (voicedMs >= startMs) {
          speaking = true;
          silentMs = 0;
          speechMs = voicedMs;
          return 'start';
        }
        return null;
      }

      if (loud) {
        silentMs = 0;
        speechMs += ms;
      } else {
        silentMs += ms;
      }
      if (silentMs >= endMs) {
        const real = speechMs >= minSpeechMs;
        speaking = false;
        voicedMs = 0;
        speechMs = 0;
        return real ? 'end' : 'noise';
      }
      return null;
    },
    reset() {
      speaking = false;
      voicedMs = 0;
      silentMs = 0;
      speechMs = 0;
    },
  };
}
