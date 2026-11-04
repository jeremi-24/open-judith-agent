// Agent mode, guided: Judith takes the user to a goal step by step, in a loop.
//
//   "Agent, exporte cette vidéo en MP4"
//     → she marks the first step and says it, then waits
//     → the user does it: the screen changes, then settles
//     → she looks again by herself and gives the next step (or a fix)
//     → … until her answer ends with "done", or the user stops her
//
// She still never clicks: the user acts, she watches and continues. The user
// may also answer her by voice; the answer goes back into the loop.
import { CHANGED, regionDiff } from './pixels.js';

export const AGENT_MAX_STEPS = 12;
// What the notch asks when the screen changed: main turns it into the next step.
export const AGENT_NEXT = '(agent:next)';
// Waiting for the user to act: after this, the loop ends by itself.
export const AGENT_IDLE_MS = 3 * 60_000;

// The special word: "Agent, …", "Mode agent : …" at the start of a question.
const TRIGGER = /^\s*(?:(?:le\s+|en\s+)?mode\s+agent|agent)(?![\p{L}\p{N}])[\s,:;.!-]*/iu;

// The goal of an agent request, or null for an ordinary question.
export function agentGoal(text) {
  const t = String(text ?? '');
  const match = TRIGGER.exec(t);
  if (!match) return null;
  const goal = t.slice(match[0].length).trim();
  return goal.length >= 3 ? goal : null;
}

// The loop's state, and the question sent to the model at each step.
export function createAgent({ maxSteps = AGENT_MAX_STEPS } = {}) {
  let goal = null;
  let step = 0;
  const frame = (body) => `(Agent mode, step ${step}/${maxSteps}) Goal: ${goal}\n${body}`;
  return {
    maxSteps,
    get active() {
      return goal != null;
    },
    get goal() {
      return goal;
    },
    get step() {
      return step;
    },
    // A question from the user: starts the loop (special word), continues it
    // (an answer to Judith while it runs), or passes through unchanged.
    question(text) {
      const newGoal = agentGoal(text);
      if (newGoal) {
        goal = newGoal;
        step = 1;
        return frame('Take me to this goal, one step at a time.');
      }
      if (goal == null) return text;
      if (step >= maxSteps) {
        this.stop();
        return text;
      }
      step += 1;
      return frame(`My answer: ${text}`);
    },
    // The user did something: the next question, or null when the loop is over.
    next() {
      if (goal == null) return null;
      if (step >= maxSteps) {
        this.stop();
        return null;
      }
      step += 1;
      return frame('The screen changed after your last step. Look at it now, then give the next step only (or a fix if it went wrong), or "done" if the goal is reached.');
    },
    stop() {
      goal = null;
      step = 0;
    },
  };
}

// Tiles of the screen whose content changed between two small screenshots.
export function changedTiles(a, b, exclude = [], cols = 8, rows = 6) {
  const tiles = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rect = { x1: c / cols, y1: r / rows, x2: (c + 1) / cols, y2: (r + 1) / rows };
      if (regionDiff(a, b, rect, exclude) > CHANGED) tiles.push(r * cols + c);
    }
  }
  return tiles;
}

// Did the user do the step? Feed it a small screenshot every ~700 ms while
// Judith waits. The first frames learn what moves by itself (a video, an
// animation), which is ignored afterwards. Then: 'waiting' (nothing new),
// 'changing' (something changed, still moving), 'changed' (changed, and
// settled for settleFrames frames: time for the next step).
export function createProgressWatch({ learnFrames = 2, settleFrames = 2, cols = 8, rows = 6 } = {}) {
  let baseline = null;
  let previous = null;
  let seen = 0;
  let stable = 0;
  const noisy = new Set();
  return {
    get noisy() {
      return noisy.size;
    },
    push(image, exclude = []) {
      if (!baseline) {
        baseline = previous = image;
        return 'waiting';
      }
      const moving = changedTiles(previous, image, exclude, cols, rows);
      previous = image;
      seen += 1;
      if (seen <= learnFrames) {
        for (const tile of moving) noisy.add(tile);
        baseline = image;
        return 'waiting';
      }
      const fromBaseline = changedTiles(baseline, image, exclude, cols, rows).filter((t) => !noisy.has(t));
      if (!fromBaseline.length) {
        stable = 0;
        return 'waiting';
      }
      if (moving.some((t) => !noisy.has(t))) {
        stable = 0;
        return 'changing';
      }
      stable += 1;
      return stable >= settleFrames ? 'changed' : 'changing';
    },
  };
}
