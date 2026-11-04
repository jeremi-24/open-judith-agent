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
**API key** (Anthropic, OpenAI, Google Gemini, OpenRouter). Pick it from the gear in the notch.

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
  she annotates it. Escape or a simple click cancels.
- **Session mode** *(planned)*: give her a goal, she guides you step by step, quizzes
  you and tracks what you have learned.

## Requirements

- Windows 10/11
- One brain for Judith, any of:
  - [Claude Code](https://code.claude.com) installed and logged in (`claude` works in a terminal): the best fit,
    kept warm for fast answers, with its memory, skills and connectors;
  - OpenAI Codex (`codex`) or Cursor's agent (`agent`), logged in: they bring their own project
    knowledge (AGENTS.md, Cursor rules); slower, one process per question;
  - an API key (Anthropic, OpenAI, Google Gemini, OpenRouter, or an OpenAI-compatible server like
    Ollama): a bare model, without memory of your projects.

### Choosing the engine

The gear in the notch (on the resting pill when hovered, or while listening) lists the engines
installed on this PC. **Automatique** picks Claude Code, else Codex, else Cursor, else your API key.
**Tester** sends a tiny question with a tiny image and says if it works (the model must read
images to see your screen). API keys are encrypted with Windows' protection for your account
(`keys.json`), never written in `config.json`. Keys can also come from `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `GEMINI_API_KEY` or `OPENROUTER_API_KEY`.

Only Claude Code can ask for the screen when it needs it; with the other engines Judith sends a
screenshot with every question. Codex runs in its read-only sandbox and Cursor without `--force`:
neither can change your files. Their prompt is written to a temporary file (deleted after the
answer) so no text ever goes on a command line.

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

### When marks disappear

A mark is only true for the screen Judith looked at. It is not drawn if that part of the
screen already changed (you scrolled, clicked, switched window), and it disappears as soon as
what is under it changes, or after a minute.

### What Judith is allowed to do

Claude Code starts Judith's own MCP server (`src/mcp/server.js`) with two tools:
`look_at_screen` and `show_visual`. Besides them, Judith may only read (`Read`, `Glob`,
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
- Pointing is precise on regular buttons but can be off by ~30 px on tiny icons
  (taskbar). Windows UI Automation is planned to snap marks onto real controls.
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

## License

MIT
