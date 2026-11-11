// Agent mode, autonomous: runs the actions of one step, one by one, each one
// checked by the guardrails first. Everything that touches the computer is
// injected (fx), so the order of the checks is tested here.
//
// For each action (at most MAX_ACTIONS_PER_STEP per step):
//   1. locate: where it lands (app, real control, on Judith or not)
//   2. guard:  allow / confirm / block (src/core/guard.js)
//   3. confirm with the user when asked; "Non" stops the step
//   4. show:   a mark where she is about to act (the user sees it coming)
//   5. do it;  "user" (the mouse moved) stops everything
import { t } from './i18n.js';
import { checkAction, MAX_ACTIONS_PER_STEP } from './guard.js';

// fx = {
//   locate(action) → { app, control, onJudith, point }
//   confirm(reason, action) → true | false
//   show(action, target)            optional
//   perform(action, target) → { ok } | { error }   ('user': the user took the mouse)
// }
// state = { count, lastControl } (kept across steps by the caller)
// → { done, stopped?: 'blocked' | 'declined' | 'user' | 'error', reason? }
export async function runActions(actions, fx, state = { count: 0, lastControl: null }) {
  let done = 0;
  for (const action of actions.slice(0, MAX_ACTIONS_PER_STEP)) {
    const target = await fx.locate(action);
    // Typing goes where the last click went: that field's name is what counts.
    const control = action.action === 'type' ? (target.control ?? state.lastControl) : target.control;
    const check = checkAction({ ...action, type: action.action }, { app: target.app, control, onJudith: target.onJudith, count: state.count });
    if (check.verdict === 'block') return { done, stopped: 'blocked', reason: check.reason };
    if (check.verdict === 'confirm' && !(await fx.confirm(check.reason, action))) return { done, stopped: 'declined', reason: check.reason };
    await fx.show?.(action, target);
    const result = await fx.perform(action, target);
    if (result?.error === 'user') return { done, stopped: 'user', reason: t('Tu as bougé la souris : je te rends la main.') };
    if (result?.error) return { done, stopped: 'error', reason: t("Je n'ai pas pu le faire ({error}).", { error: result.error }) };
    state.count += 1;
    if (action.action === 'click') state.lastControl = target.control ?? null;
    done += 1;
  }
  return { done };
}
