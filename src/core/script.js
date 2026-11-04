// Judith answers with a tiny line-based script that mixes speech and drawing,
// so each drawing appears exactly when she talks about it:
//
//   say Le bouton Exporter est en haut à droite.
//   box 0.79 0.04 0.85 0.08 | Exporter
//   step Clique sur Exporter
//   say Ensuite, choisis le format MP4.
//   board Exporter une vidéo | Les réglages qui comptent
//   note Le MP4 se lit partout
//   scene 2                (moves the 3D scene to its 2nd step)
//   done                   (agent mode: the goal is reached)
//   act click 0.42 0.18 | Exporter   (autonomous agent mode: Judith clicks herself)
//
// Coordinates are fractions (0..1) of the screenshot; ring and box take the
// corners of the element (left top right bottom), or a single point.
// Lines are read as they stream in; a line that is not a command is spoken.

const NUMBER = /^-?\d*\.?\d+$/;
const clamp01 = (n) => Math.min(1, Math.max(0, n));

function splitLabel(rest) {
  const bar = rest.indexOf('|');
  return bar < 0 ? [rest.trim(), ''] : [rest.slice(0, bar).trim(), rest.slice(bar + 1).trim()];
}

function numbers(text) {
  const parts = text.split(/[\s,]+/).filter(Boolean);
  return parts.every((p) => NUMBER.test(p)) ? parts.map(Number) : null;
}

// "click 0.4 0.2 | Exporter", "click 0.4 0.2 right | …", "type bonjour | Recherche",
// "key ctrl+s", "scroll 0.5 0.5 -3" → { action, … } or null.
export function parseAction(rest) {
  const space = rest.trim().indexOf(' ');
  const verb = (space < 0 ? rest.trim() : rest.trim().slice(0, space)).toLowerCase();
  const args = space < 0 ? '' : rest.trim().slice(space + 1);
  const [main, label] = splitLabel(args);
  switch (verb) {
    case 'click': {
      const parts = main.split(/\s+/).filter(Boolean);
      const button = ['right', 'double'].includes(parts[2]?.toLowerCase()) ? parts[2].toLowerCase() : 'left';
      const n = numbers(parts.slice(0, 2).join(' '));
      return n?.length === 2 ? { action: 'click', x: clamp01(n[0]), y: clamp01(n[1]), button, label } : null;
    }
    case 'type':
      return main ? { action: 'type', text: main, label } : null;
    case 'key':
      return main ? { action: 'key', combo: main.toLowerCase().replace(/\s+/g, '') } : null;
    case 'scroll': {
      const n = numbers(main);
      return n?.length === 3 ? { action: 'scroll', x: clamp01(n[0]), y: clamp01(n[1]), notches: Math.max(-15, Math.min(15, Math.round(n[2]))) } : null;
    }
    default:
      return null;
  }
}

export function parseLine(raw) {
  const line = raw.trim().replace(/^[-*•]\s+/, '');
  if (!line || line.startsWith('```')) return null;
  const space = line.indexOf(' ');
  const word = (space < 0 ? line : line.slice(0, space)).toLowerCase();
  const rest = space < 0 ? '' : line.slice(space + 1);

  switch (word) {
    case 'say':
      return rest.trim() ? { type: 'say', text: rest.trim() } : null;
    case 'ring':
    case 'box': {
      const [coords, label] = splitLabel(rest);
      const n = numbers(coords);
      if (!n || (n.length !== 2 && n.length !== 4)) return null;
      const [left, top, right = left, bottom = top] = n.map(clamp01);
      const [x1, x2] = [Math.min(left, right), Math.max(left, right)];
      const [y1, y2] = [Math.min(top, bottom), Math.max(top, bottom)];
      return { type: 'mark', shape: word, x: (x1 + x2) / 2, y: (y1 + y2) / 2, w: x2 - x1, h: y2 - y1, label };
    }
    case 'arrow': {
      // A hand-drawn arrow from one thing to another: a link, a flow, a cause.
      const [coords, label] = splitLabel(rest);
      const n = numbers(coords);
      if (!n || n.length !== 4) return null;
      const [x1, y1, x2, y2] = n.map(clamp01);
      if (x1 === x2 && y1 === y2) return null;
      return { type: 'mark', shape: 'arrow', points: [[x1, y1], [x2, y2]], x: (x1 + x2) / 2, y: (y1 + y2) / 2, w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), label };
    }
    case 'shape': {
      const [coords, label] = splitLabel(rest);
      const n = numbers(coords);
      if (!n || n.length < 6 || n.length % 2) return null;
      const points = [];
      for (let i = 0; i < n.length; i += 2) points.push([clamp01(n[i]), clamp01(n[i + 1])]);
      const xs = points.map((p) => p[0]);
      const ys = points.map((p) => p[1]);
      const x = (Math.min(...xs) + Math.max(...xs)) / 2;
      const y = (Math.min(...ys) + Math.max(...ys)) / 2;
      return { type: 'mark', shape: 'shape', points, x, y, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), label };
    }
    case 'step':
      return rest.trim() ? { type: 'step', text: rest.trim() } : null;
    case 'scene': {
      // The voice reached step n of the 3D scene (1-based).
      const n = Number(rest.trim());
      return Number.isInteger(n) && n >= 1 ? { type: 'scene', step: n } : { type: 'say', text: line };
    }
    case 'board': {
      const [title, subtitle] = splitLabel(rest);
      return title ? { type: 'board', title, subtitle } : null;
    }
    case 'note':
      return rest.trim() ? { type: 'note', text: rest.trim() } : null;
    case 'clear':
      return { type: 'clear' };
    case 'act': {
      // Agent mode, autonomous: an action Judith does herself (checked by guard.js).
      const action = parseAction(rest);
      return action ? { type: 'act', ...action } : { type: 'say', text: line };
    }
    case 'done':
      // Agent mode: the goal is reached (an optional last sentence is spoken).
      return { type: 'done', text: rest.trim() };
    default:
      // Not a command: Judith says it.
      return { type: 'say', text: line };
  }
}

// Feeds the growing answer text; calls onCommand once per complete line.
// finish() flushes the last line when the answer is over.
export function createScriptReader(onCommand) {
  let done = 0;
  let last = '';
  const emit = (line) => {
    const command = parseLine(line);
    if (command) onCommand(command);
  };
  return {
    push(text) {
      last = text;
      let newline;
      while ((newline = text.indexOf('\n', done)) >= 0) {
        emit(text.slice(done, newline));
        done = newline + 1;
      }
    },
    finish(text = last) {
      this.push(text);
      if (done < text.length) emit(text.slice(done));
      done = text.length;
    },
  };
}
