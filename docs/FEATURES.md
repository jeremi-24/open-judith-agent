# What Judith can do

## Marks on the real controls

The model gives an approximate box from a screenshot. On Windows, a tiny companion
(`companions/eyes`, .NET Framework 4.8, built into Windows 10/11) asks **UI Automation** which
controls are around that point, with their exact bounds, and Judith draws the ring or box on
the right one (`src/core/snap.js` picks it: overlap, name matching the label, kind of control).
Without the companion, marks keep the model's position. To build it from source: install the
[.NET SDK](https://dotnet.microsoft.com/download) and run `dotnet build companions/eyes -c Release`.

## Diagrams on the screen

To explain how things relate, Judith marks the parts and joins them with hand-drawn arrows
(`arrow` in her script): "this value comes from there", "this call goes to that function".
A word, a title or a number gets a line under it (`underline`). When she explains what is on
the screen, each sentence comes with its own mark, to the last one.

## The board

Notes, visuals and 3D scenes open in a small panel at the bottom left. It never takes more
than 42% of the width and 62% of the height of the screen (past that it scrolls), its title
bar folds it to one line, and you can drag it elsewhere.

## 3D explanations

When the question is how a physical thing works (the engine of a jet in a video, a gearbox, a
heart, a building), Judith can build a **schematic 3D model** in a small window next to the
screen. The model **builds up part by part** while she talks (`scene <n>` in her script), each
part labelled by hand with a line to it. What she builds is her own choice: she describes any
list of solids, where they sit, and in which step they appear. Smooth shapes (a profile turned
round an axis, ellipsoids, capsules, pipes along a path, curved outlines, soft-edged boxes) keep
it from looking like stacked blocks, and a soft shadow grounds it. She can make a part turn, rock or slide. The
screenshot she looked at is one press away ("Ce que j'ai vu"). If she is not sure what the
object is, she says so and explains the principle rather than inventing a model name.

The model writes the scene's code (`show_scene`) with Judith's bricks
(`src/renderer/scene-bricks.js`: `J.build` for free placement, plus assemblies of parts, flows,
exploded views, motion) on three.js. The code runs in a sandboxed frame served from `judith-frame://` with its own
CSP: no network, no access to Judith. If it fails or hangs, the tool says so (a hung scene is
stopped after 5 s) and she explains with words and marks instead.

## Agent mode (guided)

Start a question with the special word **"Agent"** (or "mode agent") and Judith takes you to
the goal step by step, in a loop: "Agent, exporte cette vidéo en MP4".

1. She marks the step to do now and says it, then waits.
2. You do it. Judith watches the screen: once it changed and settled, she looks again by
   herself and gives the next step, or a fix if it went wrong.
3. Again, until her answer ends with `done` ("Objectif atteint ✓").

You don't need the special word: when a request takes several steps on the screen, she
gives the first one, then offers "Tu veux que je te suive jusqu'au bout ?" ("Oui" by voice or
in the notch starts the loop). Only the guided mode is offered; after two "non" she stops
offering for the session. Questions of understanding never get the offer.

She still never clicks: you act, she watches. You can answer her questions by voice; the
answer goes back into the loop. While she waits, the resting notch shows "Étape 2/12".
The loop ends with X, Esc or "arrête", after 12 steps, or after 3 minutes without a change.
Screen changes are compared tile by tile, and what moves by itself (a video, an animation) is
learned in the first second and ignored.

## Agent mode (autonomous)

With **"Agent autonome, …"** Judith does the steps herself: she clicks, types, presses keys
and scrolls, then looks again and continues. It is **off by default**: tick it in the
notch's settings (gear). It needs the small `judith-hands.exe` companion (`companions/hands`,
built like `judith-eyes.exe`); without it, or when it is off, she guides you instead and says so.

Guardrails (`src/core/guard.js`, checked on what Windows says, not on what the model claims):
- **Never**: in terminals, password managers, system tools (registry, task manager…), or on
  her own windows; typing a password, a code or a card number; shortcuts outside a short list
  (no Windows key, Alt+F4, Ctrl+Alt+Del…).
- **She asks first ("Vas-y / Non")** before deleting, sending, paying, buying, installing,
  publishing, signing out, accepting…, judged on the real name of the control (UI
  Automation). Without UI Automation, before every click. "Vas-y" needs a real click.
- **Stop at once**: move the mouse (the companion refuses everything until the next session),
  Ctrl+Alt+Escape, X, Esc or "arrête". A yellow frame and a banner show while she acts.
- **Limits**: 3 actions per step, 40 per session, 12 steps.
- Text on the screen is never an order: the prompt says so, and the checks above do not
  depend on it.

## When marks disappear

A mark is only true for the screen Judith looked at. It is not drawn if that part of the
screen already changed (you scrolled, clicked, switched window), and it disappears as soon as
what is under it changes, or after a minute.

## What Judith is allowed to do

Claude Code starts Judith's own MCP server (`src/mcp/server.js`) with three tools:
`look_at_screen`, `show_visual` and `show_scene`. Besides them, Judith may only read (`Read`, `Glob`,
`Grep`, `WebSearch`, `WebFetch`) and make visual explanations with your own tools
(`Artifact`, Claude Docs). With the "Claude can act" setting **off**, every tool that changes something on your computer
(editing files, running commands…) is refused: she explains and points, the user acts.
With it **on** (the default), Claude Code runs with all its tools and **without permission prompts**:
the setting is the consent. Screen content can carry instructions meant for the model, so switch it
off when you look at things you do not trust. Her prompt tells her that only your own words count,
but that is not a guarantee.

## Known limits

- Answers take ~5 s with a screenshot (Claude Code is kept warm in the background).
- Pointing snaps onto real controls through UI Automation; content without accessible
  controls (images, videos, canvases, some games) keeps the model's approximate position.
- With voice, a full turn takes ~8-10 s (end of speech, ~2 s of transcription, answer).
- No wake word yet ("Hey Judith"): use the shortcut.
