<p align="center">
  <img src="assets/icon.png" width="120" alt="Judith">
</p>

<h1 align="center">Judith Agent</h1>

<p align="center"><b>Claude Code sees your files. Judith sees your screen.</b><br>
<i>Je te montre, tu apprends.</i></p>

---

Judith is a desktop mentor for Windows that does one thing: **she explains what is on your
screen**. Press a shortcut, ask a question (about the whole screen or a zone you draw), and
Judith **draws the answer right on top of your software** (rings, boxes, numbered steps)
and explains it with examples taken from what you see, in any app: VS Code, CapCut,
Blender, Excel…

She points, you click: Judith never acts on your computer.

She runs on **your own Claude Code**, so she shares its memory, skills and MCP
connectors. She already knows your projects and your level on day one.
No Claude Code? She also works with **OpenAI Codex**, **Cursor**, or a model with your own
**API key** (NVIDIA, Google Gemini, Groq and Mistral have free tiers; Anthropic, OpenAI, OpenRouter). Pick it from the gear in the notch.

> 🚧 Early work in progress (v0.1). Windows first.

## How it works

```
Ctrl + Alt + J ─► screenshot ─► your Claude Code (kept warm in the background)
                                    │  same memory, same skills
                                    ▼
          answer + steps + where to point (normalized coordinates)
                                    │
                                    ▼
      transparent click-through overlay draws rings, arrows and labels
```

- **Talk to her**: the shortcut opens the notch and listens. Stop talking and she
  answers out loud. Speech-to-text runs locally (Whisper), and so does her neural voice
  (Piper "Siwis"): no cloud, no API key.
- **She shows and explains**: "where is the export button?" → she circles it. "c'est quoi ça ?"
  → she marks each part on the screen while explaining it, using the real names and values
  on your screen. She never opens, edits, runs or sends anything.
- **She builds visual explanations**: when a diagram, an interactive page or a document
  explains better, Claude Code makes it with your own tools (Artifacts, Docs…) and Judith
  opens it in your browser, with a card in the notch. She never reads a link aloud.
- **Show her a zone**: press **Ctrl + Alt + Shift + J** (or the frame button in the notch)
  and draw a rectangle around what you want to understand. Only that zone is sent, and
  she annotates it. Escape or a simple click cancels. Draw another zone and the first one
  stays as a numbered thumbnail in the notch (up to 4, a cross removes one): she sees them
  all and can compare them.
- **Session mode** *(planned)*: give her a goal, she guides you step by step, quizzes
  you and tracks what you have learned.

## Requirements

- Windows 10/11
- One brain for Judith, any of:
  - [Claude Code](https://code.claude.com) installed and logged in (`claude` works in a terminal): the best fit,
    kept warm for fast answers, with its memory, skills and connectors;
  - OpenAI Codex (`codex`) or Cursor's agent (`agent`), logged in: they bring their own project
    knowledge (AGENTS.md, Cursor rules); slower, one process per question;
  - an API key (NVIDIA, Google Gemini, Groq, Mistral, Anthropic, OpenAI, OpenRouter, or an OpenAI-compatible server like
    Ollama): a bare model, without memory of your projects.

### Choosing the engine

The gear in the notch (on the resting pill when hovered, or while listening) lists the engines
installed on this PC. **Automatique** picks Claude Code, else Codex, else Cursor, else your API key.
**Tester** sends a tiny question with a tiny image and says if it works (the model must read
images to see your screen). API keys are encrypted with Windows' protection for your account
(`keys.json`), never written in `config.json`. Keys can also come from `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `GEMINI_API_KEY`, `NVIDIA_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY` or `OPENROUTER_API_KEY`.

Only Claude Code can ask for the screen when it needs it; with the other engines Judith sends a
screenshot with every question. Codex runs in its read-only sandbox and Cursor without `--force`:
neither can change your files. Their prompt is written to a temporary file (deleted after the
answer) so no text ever goes on a command line.

## Languages

French and English. On a first start Judith takes the language of Windows; change it with the
**FR | EN** switch of the welcome window or **Langue / Language** in the tray menu.
See [docs/I18N.md](docs/I18N.md) to add a sentence or a language.

## Install

1. Download `Judith-Setup-<version>.exe` from the
   [latest release](https://github.com/jeremi-24/open-judith-agent/releases/latest).
2. Run it. The installer is not code-signed yet, so Windows SmartScreen may say
   "Windows protected your PC": click **More info → Run anyway**.
3. Judith starts, and from now on with Windows (right-click her icon near the clock to
   turn that off). Press **Ctrl + Alt + J** anywhere.

No admin rights needed. Uninstall from **Settings → Apps → Installed apps**; your settings,
keys and diary stay in `%APPDATA%\open-judith-agent`.

## Run from source

Requires Node.js 22+.

```bash
git clone https://github.com/jeremi-24/open-judith-agent.git
cd open-judith-agent
npm install
npm start
```

To build the installer, see [docs/RELEASING.md](docs/RELEASING.md).

### Configuration

Judith reads `config.json` in her user data folder
(`%APPDATA%\open-judith-agent\config.json`). All keys are optional:

```json
{
  "workingDirectory": "C:\\Users\\you\\projects",
  "claudePath": "C:\\Users\\you\\.local\\bin\\claude.exe",
  "model": "haiku",
  "language": "fr",
  "shortcut": "Control+Alt+J",
  "voiceInput": true,
  "speechModel": "onnx-community/whisper-base",
  "hideFromScreenRecordings": true
}
```

- `workingDirectory` matters: Claude Code loads the memory and `CLAUDE.md` of that folder,
  so point it where you usually run `claude`. In JSON, write paths with `/` or `\\`.
- `voiceInput`: listen as soon as Judith is summoned. The Whisper model (~80 MB) is
  downloaded once on first launch, then everything stays offline.
- `voice`: `siwis` (local neural voice, ~65 MB downloaded once) or `windows`
  (the system voices, more robotic). `voiceSpeed`: 1 = normal.
- `hideFromScreenRecordings`: keep `true` for privacy; set `false` to film demos with OBS.
- `alwaysLook` (default `false`): Judith takes a screenshot only when the question needs it
  (her `look_at_screen` tool). `true` sends one with every question, slower.
- `zoneShortcut` (default `Control+Alt+Shift+J`): summon Judith and draw the zone to explain.
- `openCreations` (default `true`): open what Claude makes to explain (artifact, diagram, document) in the browser.
- `conversation` (default `true`): after answering, Judith listens for 5 more seconds.
- `annotations`: `helpful` (default, draws only when it saves you searching), `none`, `always`.

### Cloud voice and listening (optional, your own keys)

Out of the box everything is local: Whisper listens, Piper "Siwis" speaks. For the best
quality, the same approach as commercial assistants is available with your own accounts:

| Setting | Effect |
|---|---|
| `"speechInput": "deepgram"`, `"deepgramKey": "…"` | Live listening with [Deepgram](https://deepgram.com): words appear while you speak and the end of your sentence is detected by the service. Free credit at sign-up. |
| `"voice": "elevenlabs"`, `"elevenlabsKey": "…"` | Natural voice by [ElevenLabs](https://elevenlabs.io) (`elevenlabsVoice` = voice id). Free tier available. |
| `"voice": "fish"`, `"fishKey": "…"` | Natural voice by [Fish Audio](https://fish.audio) (`fishVoice` = voice id). The `s2.1-pro-free` model is free (until 30 Nov 2026 at least). |

Keys can also come from the `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY` and `FISH_API_KEY` environment variables.
If a cloud service fails (bad key, no credit), Judith falls back to the local voice.
Cloud mode sends your voice (Deepgram) and Judith's sentences (ElevenLabs) to those services.

### How a conversation works

One conversation manager (`src/core/conversation.js`) decides who talks and when; the
microphone, the transcription, Claude Code and the voice only report events to it.

- **Listening**: a voice detector that learns the room noise. A pause after "et",
  "parce que", "euh" or a comma waits for the rest of the sentence.
- **Interrupting**: talk over Judith and she stops to listen (`"interruptions": true`).
- **Cancelling**: the **X** button (or Esc) stops everything, whoever is talking, including
  Claude Code in the middle of an answer. The conversation memory is kept.
- **Follow-up**: after answering, Judith listens a few more seconds (`"conversation": true`).

### Marks on the real controls

The model gives an approximate box from a screenshot. On Windows, a tiny companion
(`companions/eyes`, .NET Framework 4.8, built into Windows 10/11) asks **UI Automation** which
controls are around that point, with their exact bounds, and Judith draws the ring or box on
the right one (`src/core/snap.js` picks it: overlap, name matching the label, kind of control).
Without the companion, marks keep the model's position. To build it from source: install the
[.NET SDK](https://dotnet.microsoft.com/download) and run `dotnet build companions/eyes -c Release`.

### Diagrams on the screen

To explain how things relate, Judith marks the parts and joins them with hand-drawn arrows
(`arrow` in her script): "this value comes from there", "this call goes to that function".

### 3D explanations

When the question is how a physical thing works (the engine of a jet in a video, a gearbox, a
heart), Judith can build a **schematic 3D model** next to the screen and walk through it part
by part, the model following her voice (`scene <n>` in her script). Next to it, the board
shows the screenshot she looked at ("Ce que j'ai vu"). If she is not sure what the object is,
she says so and explains the principle rather than inventing a model name.

The model writes the scene's code (`show_scene`) with Judith's bricks
(`src/renderer/scene-bricks.js`: assemblies of parts, flows, exploded views, labels, steps)
on three.js. The code runs in a sandboxed frame served from `judith-frame://` with its own
CSP: no network, no access to Judith. If it fails or hangs, the tool says so (a hung scene is
stopped after 5 s) and she explains with words and marks instead.

### Agent mode (guided)

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

### Agent mode (autonomous) — opt-in

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

### When marks disappear

A mark is only true for the screen Judith looked at. It is not drawn if that part of the
screen already changed (you scrolled, clicked, switched window), and it disappears as soon as
what is under it changes, or after a minute.

### What Judith is allowed to do

Claude Code starts Judith's own MCP server (`src/mcp/server.js`) with three tools:
`look_at_screen`, `show_visual` and `show_scene`. Besides them, Judith may only read (`Read`, `Glob`,
`Grep`, `WebSearch`, `WebFetch`) and make visual explanations with your own tools
(`Artifact`, Claude Docs). Every tool that changes something on your computer (editing
files, running commands…) is refused: she explains and points, the user acts.

## Development

```bash
npm test                                   # unit tests (no Electron needed)
node scripts/try-engine.mjs "question" img.png   # talk to Judith from the terminal
npm run bench                              # pointing-precision benchmark, see bench/
```

Demo mode asks a question at launch and saves a screenshot of the result:

```bash
JUDITH_DEMO="Où est le bouton Démarrer ?" JUDITH_DEMO_SHOT=shot.jpg npm start
```

## Known limits (v0.1)

- Answers take ~5 s with a screenshot (Claude Code is kept warm in the background).
- Pointing snaps onto real controls through UI Automation; content without accessible
  controls (images, videos, canvases, some games) keeps the model's approximate position.
- With voice, a full turn takes ~8-10 s (end of speech, ~2 s of transcription, answer).
- No wake word yet ("Hey Judith"): use the shortcut.

## Privacy

Screenshots are taken only when you press the shortcut, are sent to Claude through
your own Claude Code, and are never written to disk. Judith's own windows are excluded
from captures.

## Credits

- Voice: [Piper](https://github.com/rhasspy/piper) `fr_FR-siwis-medium`, trained on the
  [SIWIS French Speech Synthesis Database](https://datashare.is.ed.ac.uk/handle/10283/2353)
  (CC BY 4.0), run with [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache-2.0).
- Speech recognition: [Whisper](https://github.com/openai/whisper) through
  [Transformers.js](https://github.com/huggingface/transformers.js).
- Model capabilities (images, tools, open weights, limits): the [models.dev](https://models.dev)
  catalog (MIT, © models.dev), trimmed into `src/engine/catalog.snapshot.json`. See
  [docs/MODELS.md](docs/MODELS.md).

## License

MIT
