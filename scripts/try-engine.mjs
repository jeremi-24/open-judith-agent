// Talks to Judith from the terminal, without the desktop app.
// Usage: node scripts/try-engine.mjs "your question" [image.png|.jpg|.webp]
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { ClaudeCodeEngine } from '../src/engine/claude-code.js';
import { buildSystemPrompt, buildUserContent } from '../src/core/prompt.js';
import { extractAnnotations } from '../src/core/annotations.js';

const [question = 'Présente-toi en une phrase.', imagePath] = process.argv.slice(2);
const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const image = imagePath && { mediaType: types[extname(imagePath).toLowerCase()], data: readFileSync(imagePath).toString('base64') };

const engine = new ClaudeCodeEngine({
  cwd: process.env.JUDITH_CWD || process.cwd(),
  model: process.env.JUDITH_MODEL || 'haiku',
  systemPrompt: buildSystemPrompt({ language: 'fr' }),
});

let shown = 0;
engine.on('delta', (text) => {
  process.stdout.write(text.slice(shown));
  shown = text.length;
});

try {
  const result = await engine.ask(buildUserContent({ question, image }));
  const { steps, marks } = extractAnnotations(result.text);
  console.log(`\n\n— ${(result.durationMs / 1000).toFixed(1)} s · steps: ${JSON.stringify(steps)} · marks: ${JSON.stringify(marks)}`);
} finally {
  engine.stop();
}
