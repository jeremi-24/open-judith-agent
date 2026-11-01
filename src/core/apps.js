// Finds installed apps by name through their Start Menu shortcuts.
import { readdirSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

export const normalize = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export function listShortcuts(folders) {
  const found = [];
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && depth < 4) walk(path, depth + 1);
      else if (extname(entry.name).toLowerCase() === '.lnk') found.push({ name: basename(entry.name, '.lnk'), path });
    }
  };
  folders.forEach((f) => walk(f, 0));
  return found;
}

// Best matches first: exact name, then starts with, then every word present.
export function rankApps(apps, query) {
  const q = normalize(query);
  if (!q) return [];
  const words = q.split(' ');
  const score = (app) => {
    const n = normalize(app.name);
    if (/uninstall|desinstaller|readme|help|aide/.test(n)) return 0;
    if (n === q) return 100;
    if (n.startsWith(q)) return 80 - n.length / 100;
    if (words.every((w) => n.includes(w))) return 60 - n.length / 100;
    if (n.split(' ').some((w) => w.startsWith(q))) return 40;
    return 0;
  };
  return apps
    .map((app) => ({ ...app, score: score(app) }))
    .filter((app) => app.score > 0)
    .sort((a, b) => b.score - a.score);
}
