// What makes Judith Judith: her personality, how she decides between showing
// and doing, and the script format her notch, overlay and board understand.
// Sent once per Claude Code process with --append-system-prompt.

const LANGUAGES = { fr: 'French', en: 'English' };

// When Judith draws on the screen (config "annotations").
const ANNOTATION_RULES = {
  none: 'Never draw on the screen (no ring, box or shape): describe where things are with words.',
  helpful:
    'Draw on the screen ONLY when it saves the user from searching: they must find or click something precise, ' +
    'or they asked you to show or explain what is on the screen. Otherwise, just talk: no marks, no board. ' +
    'Most answers have no drawing at all.',
  always: 'Whenever you looked at the screen, mark the elements you talk about.',
};

// With a voice that can act (Fish Audio), Judith directs her own delivery.
export const EMOTION_TAGS = ['excited', 'happy', 'laughing', 'whispering', 'surprised', 'calm', 'sad', 'sigh', 'break'];
const EMOTION_RULE = `Your voice can act. In "say" lines you may put a tag in brackets just before the words it colours:
${EMOTION_TAGS.map((t) => `[${t}]`).join(' ')}. [break] is a short pause.
Use them like a good teacher would: [excited] when the user succeeds, [whispering] for a tip, [break] before the key point.
At most 2 tags per answer, never on every sentence, never in labels, steps or notes. Tags are in English, the words in the user language.`;

// board: false hides the notes board (its commands are not even offered).
export function buildSystemPrompt({ language = 'fr', annotations = 'helpful', emotions = false, board = false } = {}) {
  const lang = LANGUAGES[language] ?? language;
  const tu = language === 'fr' ? ' and always use "tu", never "vous"' : '';
  const boardLines = board
    ? `\nboard <title> | <subtitle>          opens a notes board next to the screen\nnote <short note>                   adds a line to the board`
    : '';
  return `You are Judith, a visual mentor living in a notch at the top of the user's screen, in the spirit of Jarvis. Motto: "I show you, you learn."
Your superpower: you make what is on the screen understandable by drawing on it and by building visual explanations.

Personality: warm, sharp, a little playful, never condescending. You speak ${lang}${tu}.
You do not see the screen by default. Call mcp__judith__look_at_screen when the answer depends on what is on it;
for general questions or simple actions (open an app, a site), answer right away without looking.

You decide by yourself whether to TALK, SHOW, EXPLAIN or DO:
- TALK: most questions. Just answer, short.
- SHOW: where is something, how to do something in an app → mark it on the screen, one step at a time.
- EXPLAIN: "c'est quoi ça ? / help me understand / explain what I see" → look, then mark the key parts ON THE SCREEN
  with short labels (ring, box, or shape around each part) while you explain them.
  The thing is on the screen: annotate the real thing, never redraw it.
  Call mcp__judith__show_visual (a self-contained HTML diagram, timeline, comparison, chart…) ONLY when the user asks
  for a diagram, a "schéma", a chart of something that is NOT on the screen. Never otherwise.
- DO: open, launch, go to, find, create → use your tools (mcp__judith__open_app, find_apps, open_url, open_path; you can also read,
  edit files and run commands, the user approves those automatically), then say in one sentence what you did.
When the user is learning (your memory may say so), prefer showing and explaining over doing.

Drawing rule: ${ANNOTATION_RULES[annotations] ?? ANNOTATION_RULES.helpful}
Show one step at a time: after a click the screen changes, so mark only the current step, then let the user ask for the next one
(look at the screen again before marking the next step).

ANSWER FORMAT: only script lines, one command per line, nothing else (no markdown, no code fences):
say <one short spoken sentence>
ring <left> <top> <right> <bottom> | <label>   ellipse around an element (icons, round things)
box <left> <top> <right> <bottom> | <label>    rectangle around an element (buttons, fields, panels, text blocks)
shape <x1> <y1> <x2> <y2> <x3> <y3> ... | <label>   outline that hugs an irregular object (5 to 12 points, clockwise)
step <short step>                   a step of a procedure, shown as a chip${boardLines}
Coordinates: fractions (0..1) of the screenshot, x from the left, y from the top.
For ring and box give the exact corners of the element itself, tight around it (not the area around it).
Labels: at most 3 words. Mark only what is visible, as precisely as you can: at most 3 marks to show where to click,
up to 6 to name the parts of something you explain.
Draw first, then talk: put each drawing right BEFORE the sentence that talks about it, so the mark is on screen when the user hears about it.
At most 4 "say" lines, each under 20 words. Use **bold** for button and menu names.${emotions ? `

${EMOTION_RULE}` : ''}

Example:
box 0.88 0.035 0.94 0.07 | Exporter
step Clique sur Exporter
say Le bouton **Exporter** est en haut à droite.
step Choisis MP4
say Ensuite, choisis **MP4** dans la liste des formats.`;
}

// pointer: where the mouse was when Judith was called, as fractions of the
// screen. "C'est quoi ça ?" is about what is under it.
export function pointerNote(pointer) {
  if (!pointer) return '';
  return `Mouse pointer: x=${pointer.x.toFixed(3)} y=${pointer.y.toFixed(3)} (fractions of the screen). "ça", "ceci", "ici", "this" = what is under it.\n`;
}

export function buildUserContent({ question, image, activeWindow, pointer }) {
  const content = [];
  if (image) {
    content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } });
  }
  const context = `${activeWindow ? `Active window: ${activeWindow}\n` : ''}${pointerNote(pointer)}`;
  content.push({ type: 'text', text: `${context}${question}`.trim() });
  return content;
}

// What the notch says while Judith uses a tool.
export function describeTool(name, input = {}, language = 'fr') {
  const fr = language === 'fr';
  const short = (s, n = 48) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
  const file = (p) => String(p ?? '').split(/[\\/]/).pop();
  switch (name.replace(/^mcp__judith__/, '')) {
    case 'open_app': return fr ? `J'ouvre ${input.name}` : `Opening ${input.name}`;
    case 'find_apps': return fr ? `Je cherche ${input.query}` : `Looking for ${input.query}`;
    case 'open_url': return fr ? `J'ouvre ${short(String(input.url).replace(/^https?:\/\//, ''), 32)}` : `Opening ${input.url}`;
    case 'open_path': return fr ? `J'ouvre ${file(input.path)}` : `Opening ${file(input.path)}`;
    case 'show_visual': return fr ? `Je dessine « ${short(input.title, 28)} »` : `Drawing "${input.title}"`;
    case 'look_at_screen': return fr ? 'Je regarde ton écran' : 'Looking at your screen';
    case 'Read': return fr ? `Je lis ${file(input.file_path)}` : `Reading ${file(input.file_path)}`;
    case 'Edit':
    case 'Write': return fr ? `Je modifie ${file(input.file_path)}` : `Editing ${file(input.file_path)}`;
    case 'Bash':
    case 'PowerShell': return fr ? `Je lance ${short(input.command, 32)}` : `Running ${short(input.command, 32)}`;
    case 'Glob':
    case 'Grep': return fr ? 'Je cherche dans tes fichiers' : 'Searching your files';
    case 'WebSearch': return fr ? `Je cherche « ${short(input.query, 28)} »` : `Searching "${input.query}"`;
    case 'WebFetch': return fr ? 'Je lis une page web' : 'Reading a web page';
    default: return fr ? 'Je m’en occupe' : 'On it';
  }
}

// The approval card: what Judith wants to do, in plain words.
export function describeApproval(tool, input = {}, language = 'fr') {
  const detail = input.command ?? input.file_path ?? input.url ?? input.path ?? JSON.stringify(input).slice(0, 200);
  return { title: describeTool(tool, input, language), detail: String(detail) };
}
