// What the summon shortcut does, from the state of the notch.
// - at rest: summon Judith;
// - while listening: summon too, which the conversation reads as
//   "I am done talking" (push-to-talk);
// - while she thinks or speaks: cancel everything. One gesture to start, the
//   same one to stop: no need to aim for a small button.
export function shortcutAction(notchState) {
  return notchState === 'thinking' || notchState === 'speaking' ? 'cancel' : 'summon';
}
