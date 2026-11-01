// Banc de précision : est-ce que Claude place la flèche au bon endroit ?
// Usage : node bench.mjs [modèles...]   (par défaut : haiku sonnet)
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const ici = resolve(import.meta.dirname);
const claude = process.env.CLAUDE_BIN || join(homedir(), '.local', 'bin', 'claude.exe');
const modeles = process.argv.length > 2 ? process.argv.slice(2) : ['haiku', 'sonnet'];
const captures = JSON.parse(readFileSync(join(ici, 'cibles.json'), 'utf8'));

function demander(modele, image, cible) {
  const prompt = `Lis l'image ${image} avec l'outil Read. C'est une capture d'écran.
Trouve l'élément suivant : "${cible}".
Réponds UNIQUEMENT par une ligne de JSON, sans aucun texte autour :
{"x": <nombre entre 0 et 1>, "y": <nombre entre 0 et 1>, "trouve": <true ou false>}
x et y = le centre de l'élément, en fraction de la largeur et de la hauteur de l'image (0,0 = coin en haut à gauche).`;

  const debut = Date.now();
  const sortie = execFileSync(
    claude,
    ['-p', prompt, '--model', modele, '--output-format', 'json', '--allowedTools', 'Read'],
    { cwd: ici, encoding: 'utf8', maxBuffer: 10_000_000 },
  );
  const res = JSON.parse(sortie);
  const json = res.result?.match(/\{[^{}]*\}/);
  const point = json ? JSON.parse(json[0]) : { trouve: false };
  return { ...point, secondes: (Date.now() - debut) / 1000, cout: res.total_cost_usd, brut: res.result };
}

const resultats = [];
for (const { image, cibles } of captures) {
  const chemin = join(ici, image);
  for (const cible of cibles) {
    for (const modele of modeles) {
      process.stdout.write(`${image} · "${cible}" · ${modele} … `);
      try {
        const r = demander(modele, chemin, cible);
        resultats.push({ image, cible, modele, ...r });
        console.log(r.trouve ? `(${r.x}, ${r.y}) en ${r.secondes}s` : 'pas trouvé');
      } catch (e) {
        resultats.push({ image, cible, modele, trouve: false, erreur: String(e.message).slice(0, 300) });
        console.log('erreur');
      }
    }
  }
}

writeFileSync(join(ici, 'resultats.json'), JSON.stringify(resultats, null, 2));
console.log(`\n${resultats.length} essais → resultats.json. Lance : node rapport.mjs`);
