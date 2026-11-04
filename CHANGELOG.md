# Changelog

## Unreleased

Judith now does one thing, well: she looks at your screen and explains it.

### Changed
- **She never acts on the computer.** Opening apps, sites and folders, reminders and
  alarms, copying a screenshot to share and the "Vas-y / Non" approval card are gone. Every tool that changes something is refused;
  she only looks, reads and explains. (They are all in v0.1.0 if they come back one day.)
- Her examples come from the screen itself: its names, numbers and words.
- What Claude Code makes to explain (artifacts, diagrams, documents) is still shown: a
  card in the notch, and the creation opens in the browser.
- **Other engines**: OpenAI Codex, Cursor's agent, or an API key (Anthropic, OpenAI, Google
  Gemini, OpenRouter, OpenAI-compatible servers). "Automatique" picks what is installed.
  A gear in the notch lists them, tests them (text + image) and saves API keys encrypted.
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
