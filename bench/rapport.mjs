// Dessine les points de chaque modèle sur les captures → rapport.html
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ici = resolve(import.meta.dirname);
const resultats = JSON.parse(readFileSync(join(ici, 'resultats.json'), 'utf8'));
const couleurs = { haiku: '#1DB86A', sonnet: '#8B7CF6', opus: '#FF6B5B' };
const echapper = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const groupes = new Map();
for (const r of resultats) {
  const cle = `${r.image}|${r.cible}`;
  if (!groupes.has(cle)) groupes.set(cle, []);
  groupes.get(cle).push(r);
}

const blocs = [...groupes.values()].map((essais) => {
  const { image, cible } = essais[0];
  const points = essais
    .filter((e) => e.trouve)
    .map((e) => `<span class="point" style="left:${e.x * 100}%;top:${e.y * 100}%;--c:${couleurs[e.modele] ?? '#000'}" title="${e.modele}"></span>`)
    .join('');
  const lignes = essais
    .map((e) => `<li><b style="color:${couleurs[e.modele] ?? '#000'}">● ${e.modele}</b> — ${e.trouve ? `(${(+e.x).toFixed(3)}, ${(+e.y).toFixed(3)})` : 'pas trouvé'} · ${e.secondes ?? '?'} s${e.cout != null ? ` · ${(+e.cout).toFixed(4)} $` : ''}${e.erreur ? ` · erreur : ${echapper(e.erreur)}` : ''}</li>`)
    .join('');
  return `<section><h2>« ${echapper(cible)} »</h2><p class="img">${echapper(image)}</p>
<div class="capture"><img src="${echapper(image)}" alt="">${points}</div><ul>${lignes}</ul></section>`;
});

writeFileSync(join(ici, 'rapport.html'), `<!doctype html><meta charset="utf-8"><title>Précision Judith</title>
<style>
body{font-family:system-ui,sans-serif;margin:24px;background:#FBF8F2;color:#26221F}
section{margin:0 0 48px}h2{margin:0 0 4px;font-size:18px}.img{margin:0 0 8px;color:#6F675D;font-size:13px}
.capture{position:relative;display:inline-block;max-width:100%}.capture img{display:block;max-width:100%}
.point{position:absolute;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;border:4px solid var(--c);box-shadow:0 0 0 2px #fff,0 0 0 4px #000}
ul{padding-left:18px;font-size:14px}
</style><h1>Précision de Judith — un cercle par modèle</h1>${blocs.join('\n')}`);
console.log('rapport.html généré');
