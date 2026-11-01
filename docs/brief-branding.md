# Brief branding — Judith Agent

## Le nom
- **Judith Agent**. À l'oral, on dit « Judith » (« demande à Judith »). À l'écrit : « Judith Agent » ou `judith-agent` (dépôt GitHub, hashtags), car « Judith » seul est un prénom courant, difficile à trouver.
- Un prénom humain, dans l'esprit de Jarvis : c'est une présence, pas un outil.

## En une phrase
Une assistante IA toujours disponible sur ton écran Windows. Tu appuies sur un raccourci, tu poses ta question, et Judith **regarde ton écran et te montre où cliquer** : elle dessine des flèches, des cercles et des étiquettes directement par-dessus le logiciel où tu es.

Accroche proposée : **« Claude Code voit tes fichiers. Judith voit ton écran. »**

## Le problème
Quand on bloque dans un logiciel (VS Code, CapCut, Blender, Figma, GitHub…), on sort du logiciel, on cherche un tuto qui ne correspond pas à sa version, on décrit son écran à un chatbot, puis on revient. Judith, c'est le collègue expert assis à côté de toi, qui pointe du doigt : « non, là ».

## Comment ça marche
1. Raccourci clavier → une petite bulle apparaît près de la souris.
2. Tu tapes ta question.
3. Judith capture l'écran et interroge **ton** Claude Code (ton abonnement), qui connaît déjà tes projets et ton niveau grâce à sa mémoire.
4. Elle dessine la réponse par-dessus ton écran et explique en une phrase.

## Deux modes
- **Normal** : question → réponse + dessin. Ponctuel.
- **Session** : tu lui donnes un objectif (« on continue notre exo », « je révise, aide-moi à comprendre »). Elle te suit, te guide pas à pas et fabrique des quiz, des schémas et des fiches de révision. Elle ne fait pas à ta place : elle te fait progresser.

## Pour qui
- **v1** : développeurs sous Windows qui utilisent Claude Code et apprennent des outils (débutants, personnes en reconversion, autodidactes).
- Projet **open source** sur GitHub. Objectif : 4 000 étoiles. Le README et les visuels GitHub sont en **anglais** ; l'interface est bilingue français/anglais.
- Lancé et raconté en public sur TikTok (« Jeremie Dev »).

## Personnalité (à proposer et affiner)
Une mentor bienveillante mais directe. Elle ne fait jamais tout à ta place, elle te montre et te pousse à comprendre. Claire, chaleureuse, un peu d'humour, jamais condescendante.

## Ce qu'il faut concevoir
1. **Logo** : une icône d'application, qui doit aussi marcher en icône de barre des tâches (16 et 32 px), sur fond clair et sur fond sombre.
2. **Palette de couleurs** et **typographie** (police libre : Google Fonts ou OFL).
3. **Le système d'annotations à l'écran** : c'est l'élément le plus important, car c'est ce qu'on verra dans chaque démo.
   - La bulle de question (près du curseur)
   - Le cercle, la flèche et l'étiquette « clique ici »
   - Le panneau du mode Session (quiz, schéma)
   - Les états : écoute / réfléchit / répond
   - Contrainte clé : **lisible par-dessus N'IMPORTE QUEL logiciel**, clair ou sombre, chargé ou vide (contour, halo, ombre…)
4. **Bannière GitHub** (aperçu social 1280×640) et en-tête de README.
5. Optionnel : une mascotte ou un avatar pour Judith.

## Contraintes
- **Ne pas ressembler à HeyClicky** (concurrent) : éviter les bulles dégradées bleu/orange façon iMessage, le style tout en minuscules et le nom « Clicky ».
- **Ne pas utiliser** le logo, l'étincelle orange ni l'identité visuelle de Claude/Anthropic. La mention « fonctionne avec Claude Code » en texte suffit.
- Cohérent avec Windows 11, sans copier le design Microsoft.
- Les éléments à l'écran doivent rester légers : ils ne cachent jamais le travail de l'utilisateur plus que nécessaire.

## Livrables attendus
Logo (SVG + PNG), palette (codes hex), typographie, maquettes des annotations à l'écran et de leurs états, bannière GitHub, et une page de règles d'usage courte.
