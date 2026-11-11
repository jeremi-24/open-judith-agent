# Changelog

## 0.2.0 - 2026-11-11

Judith now does one thing, well: she looks at your screen and explains it.

### Changed
- **She never acts on the computer.** Opening apps, sites and folders, reminders and
  alarms, copying a screenshot to share and the "Vas-y / Non" approval card are gone. Every tool that changes something is refused;
  she only looks, reads and explains. (They are all in v0.1.0 if they come back one day.)
- Her examples come from the screen itself: its names, numbers and words.
- What Claude Code makes to explain (artifacts, diagrams, documents) is still shown: a
  card in the notch, and the creation opens in the browser.
- **Claude Code is the only engine**, for now. Codex, Cursor and API keys (with their model
  lists and encrypted keys) are gone: one thing, done well. They are in the git history.
- **Settings of the notch, redone**: one setting per row (Claude model, thinking effort,
  drawing on the screen, push to talk, notes board, autonomous agent, language), a dot saying
  whether Claude Code was found, a **Test** and a **Save**. The round buttons of the notch share
  one size and one feedback (hover, press, keyboard focus); **Stop** became **Send**.
- **The board takes less of the screen**: at most 42% of the width and 62% of the height, a
  slim title bar that folds it to one line, and a small square window for 3D scenes.
- **Annotations to the end**: the prompt asks for one mark per sentence, and a new
  `underline` underlines a word, a title or a number. With `hideFromScreenRecordings: false`
  her own ink is no longer mistaken for a change of the screen.
- **Precise marks**: a ring or box snaps onto the real control under it, thanks to a tiny
  Windows UI Automation companion (`companions/eyes`, .NET Framework 4.8). Built by CI and by
  `npm run dist` when the .NET SDK is installed; optional at run time.
- **Diagrams on the screen**: hand-drawn arrows (`arrow`) join the parts she explains.
- **3D explanations** (`show_scene`): a schematic three.js model next to the screen, built by
  the model with Judith's bricks and explained part by part as she speaks (`scene <n>`).
  `J.build` places any solids freely (soft-edged boxes, cylinders, cones, spheres, rings, prisms,
  vaults, and smooth shapes: `lathe`, `ellipsoid`, `capsule`, `tube`, curved extrusions, with a
  soft shadow underneath), at most 8 parts; the model **builds up step by step**, each part labelled by hand with
  a leader line, and `J.spin`, `J.swing` and `J.move` show how a part works. The screenshot
  she looked at is one press away. Sandboxed, without network; a broken or hung scene is
  reported to the model, which then explains with words and marks.
- **Agent mode, guided**: "Agent, …" starts a loop. Judith gives one step, waits for the screen
  to change and settle (the user did it), looks again and gives the next one, until `done`.
  She never clicks. Stops on X / Esc / "arrête", after 12 steps or 3 minutes idle.
- **She offers it herself**: the model decides when a request takes several steps, gives the
  first one and asks "Tu veux que je te suive jusqu'au bout ?". "Oui" (voice or button) starts
  the guided loop; two "non" and she stops offering. The autonomous mode is never offered.
- **Agent mode, autonomous** (opt-in, off by default): "Agent autonome, …" lets Judith click,
  type, press keys and scroll herself through a small SendInput companion (`companions/hands`).
  Every action is checked by `src/core/guard.js` on the real app and control: never in
  terminals, password managers or on Judith; never a password or card number; "Vas-y / Non"
  before deleting, sending, paying, installing…; moving the mouse or Ctrl+Alt+Escape stops her.
- The notch reports its real size: the rest of its transparent window no longer counts as
  Judith's (screen changes and clicks there are the user's apps).

### Fixed
- HTML visuals (`show_visual`) could not run their scripts: a `srcdoc` frame inherited the
  board's CSP. Visuals now come from `judith-frame://` with their own CSP (still no network),
  and the frame fits their height again.
- The notch window keeps a fixed size: smoother motion, and Stop / X work again in every
  state. The summon shortcut stops her while she thinks or speaks.

## 0.1.0 — 2026-11-01

The first release: Judith lives at the top of your Windows screen and runs on your own
Claude Code.

### Talk to her
- **Ctrl + Alt + J** anywhere: she listens, answers out loud, and keeps the conversation
  going for a few seconds after answering.
- A real conversation manager: adaptive voice detection, a smart end of turn ("ouvre VLC
  et…" waits for the rest), talking over her interrupts her, **X** or **stop** ends it all,
  and "arrête", "salut", "c'est bon" put her to rest.
- Listening: local Whisper, or Deepgram with your own key (words appear as you speak).
- Voice: local Siwis (Piper), or Fish Audio / ElevenLabs with your own key, streamed so
  she starts talking about a second after the answer begins. She never reads a link aloud.

### She shows you
- She looks at your screen only when the question needs it (or right away when it talks
  about the screen), and draws on it: hand-drawn rings, boxes and outlines, with her pen.
- **Ctrl + Alt + Shift + J**: draw the zone you want explained; only that zone is sent.
- Marks follow the page when it scrolls and disappear when their content is gone.
- She annotates the real thing on screen, one mark per compared item, and answers
  straight away.

### She does things
- Opens apps (Store apps included, like Settings or Calculator), sites, folders and
  Windows Settings pages.
- Copies a screenshot (or your zone) to share: she opens WhatsApp or Discord, you paste
  and send. She never sends messages for you.
- Reminders and alarms she says out loud at their time, with a Windows notification,
  even after a restart.
- Documents, pages and designs made by Claude open in your browser, with a card in the
  notch. Editing files or running commands always asks you first.

### The app
- At rest, a small pill under the top edge that opens on hover.
- Windows installer (per user, no admin): Start menu and desktop shortcuts, starts with
  Windows (tray menu to turn it off), uninstall from "Apps & features". Your settings,
  keys and diary stay in `%APPDATA%\open-judith-agent`.
- A usage diary (`journal.jsonl`), on your PC only, to learn what Judith is really used for.

### Known limits
- Windows only; Claude Code must be installed and logged in.
- About 3 to 5 s before she speaks without looking, 6 to 9 s when she reads the screen.
- The installer is not code-signed yet: Windows SmartScreen asks for confirmation.
