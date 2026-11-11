// Which sentences of Judith need an English version, and which have none yet.
//   node scripts/i18n-keys.mjs        lists the missing ones (and the unused ones)
// The French sentence is the key (see src/core/i18n.js). The sentences come from:
//   - every t("…") call in src/
//   - the text, title, aria-label, placeholder and alt of every page in src/renderer/*.html
// The test (test/i18n.test.js) fails when one is missing.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = join(import.meta.dirname, '..');
const src = join(root, 'src');
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const unescape = (text) => text.replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n');
// HTML entities as the browser reads them.
const decode = (text) => text.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
export const keyOf = (text) => decode(String(text)).replace(/\s+/g, ' ').replace(/[’‘]/g, "'").trim();

// Words and symbols that are the same in both languages: no entry needed.
const SAME = new Set(['Judith', 'Claude Code', 'Haiku', 'Sonnet', 'Opus', 'Max', 'Deepgram', 'Ctrl', 'Alt', 'Shift', 'J', 'OK', '✓', '✗', '?', 'Judith overlay', 'FR', 'EN']);

function fromScripts() {
  const found = [];
  for (const file of walk(src).filter((f) => /\.(m?js|cjs)$/.test(f) && !/locales|catalog\.snapshot|core[\\/]i18n\.js/.test(f))) {
    const code = readFileSync(file, 'utf8');
    for (const m of code.matchAll(/\bt\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/gs)) found.push({ key: keyOf(unescape(m[2])), where: relative(root, file) });
  }
  return found;
}

function fromPages() {
  const found = [];
  for (const file of walk(join(src, 'renderer')).filter((f) => f.endsWith('.html') && !f.endsWith('scene.html'))) {
    const html = readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/g, '');
    const where = relative(root, file);
    for (const m of html.matchAll(/>([^<>]+)</g)) {
      const key = keyOf(m[1]);
      if (/[\p{L}]{2}/u.test(key)) found.push({ key, where });
    }
    for (const m of html.matchAll(/\b(?:title|aria-label|placeholder|alt)="([^"]+)"/g)) {
      const key = keyOf(m[1]);
      if (/[\p{L}]{2}/u.test(key)) found.push({ key, where });
    }
  }
  return found;
}

export async function sentences() {
  const all = [...fromScripts(), ...fromPages()].filter((s) => s.key && !SAME.has(s.key));
  const byKey = new Map();
  for (const s of all) if (!byKey.has(s.key)) byKey.set(s.key, s.where);
  return byKey;
}

export async function report() {
  const { EN } = await import(pathToFileURL(join(src, 'core', 'locales', 'en.js')).href);
  const have = new Set(Object.keys(EN).map(keyOf));
  const needed = await sentences();
  const missing = [...needed].filter(([key]) => !have.has(key));
  const unused = [...have].filter((key) => !needed.has(key));
  return { missing, unused, total: needed.size };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { missing, unused, total } = await report();
  console.log(`${total} sentences, ${missing.length} without an English version, ${unused.length} unused`);
  for (const [key, where] of missing) console.log(`MISSING  ${where}  ${JSON.stringify(key)}`);
  for (const key of unused) console.log(`UNUSED   ${JSON.stringify(key)}`);
}
