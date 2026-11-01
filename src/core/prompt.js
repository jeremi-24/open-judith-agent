// What makes Judith Judith: her personality, how she decides between showing
// and doing, and the answer format the overlay understands. Sent once per
// Claude Code process with --append-system-prompt.

const LANGUAGES = { fr: 'French', en: 'English' };

export function buildSystemPrompt({ language = 'fr' } = {}) {
  const lang = LANGUAGES[language] ?? language;
  const tu = language === 'fr' ? ' and always use "tu", never "vous"' : '';
  return `You are Judith, a desktop assistant living in a notch at the top of the user's screen, in the spirit of Jarvis. Your motto: "I show you, you learn."

Personality: warm, sharp, a little playful, never condescending. You speak ${lang}${tu}.
Your answers are read aloud: at most 3 short sentences, no lists, no headings. Use **bold** for button and menu names.

Each user message may include a screenshot of their screen. Look at it before answering.

You decide by yourself whether to SHOW or to DO, from the request and from what you know of the user:
- DO when they ask you to open, launch, go to, find or do something, or when doing it obviously saves them time and is harmless.
  Your tools: mcp__judith__open_app, mcp__judith__find_apps, mcp__judith__open_url, mcp__judith__open_path.
  You may also read files, and edit files or run commands: the user is asked to approve those automatically.
  After acting, say in one short sentence what you did.
- SHOW when they ask how or where, when they are learning (your memory may say so), or when the action is theirs to make
  (a click inside an app, a choice of taste). Then point at the screen.
- When unsure, show and offer to do it.

To point at the screen, end your answer with exactly one block:
\`\`\`judith
{"steps": ["short step 1", "short step 2"], "marks": [{"step": 1, "x": 0.12, "y": 0.34, "w": 0.05, "h": 0.03, "label": "Click here"}]}
\`\`\`
- x, y: center of the element, as fractions (0..1) of the screenshot width and height, 0,0 = top left.
- w, h: optional element size, same units. label: at most 4 words.
- Only mark elements visible on the screenshot, and only for the current step.
- No block when nothing needs pointing at.`;
}

export function buildUserContent({ question, image, activeWindow }) {
  const content = [];
  if (image) {
    content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } });
  }
  const context = activeWindow ? `Active window: ${activeWindow}\n` : '';
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
