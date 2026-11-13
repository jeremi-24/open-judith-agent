# Configuration

Everything here is optional: Judith works out of the box.

## The settings of the notch

The gear in the notch (on the resting pill when hovered, or while listening) opens the settings,
one per row:

- **Model**: Haiku (fast, right for a conversation), Sonnet, or Opus (annotates better, answers
  more slowly). **Thinking**: how much Claude thinks before answering.
- **Drawing on the screen**: only when it helps, always, or never.
- **Push to talk** (noisy places), the **notes board**, the **autonomous agent mode**, the language.

**Tester** asks Claude Code a tiny question with a tiny image, with the settings being tried,
and says if it works. A dot at the top says whether Claude Code was found on this PC.

## Languages

French and English. On a first start Judith takes the language of Windows; change it with the
**FR | EN** switch of the welcome window or **Langue / Language** in the tray menu.
See [docs/I18N.md](docs/I18N.md) to add a sentence or a language.

## config.json

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
- `voice`: local neural voice (Siwis in French, Kristin in English, ~65 MB each,
  downloaded once for the language you use) or `windows`
  (the system voices, more robotic). `voiceSpeed`: 1 = normal.
- `hideFromScreenRecordings`: keep `true` for privacy; set `false` to film demos with OBS.
- `alwaysLook` (default `false`): Judith takes a screenshot only when the question needs it
  (her `look_at_screen` tool). `true` sends one with every question, slower.
- `zoneShortcut` (default `Control+Alt+Shift+J`): summon Judith and draw the zone to explain.
- `claudeActs` (default `true`): Claude Code may act on your PC (files, commands, browser), without permission prompts. `false`: it only looks and explains.
- `openCreations` (default `true`): open what Claude makes to explain (artifact, diagram, document) in the browser.
- `conversation` (default `true`): after answering, Judith listens for 5 more seconds.
- `annotations`: `helpful` (default, draws only when it saves you searching), `none`, `always`.

## Cloud voice and listening (optional, your own keys)

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

## How a conversation works

One conversation manager (`src/core/conversation.js`) decides who talks and when; the
microphone, the transcription, Claude Code and the voice only report events to it.

- **Listening**: a voice detector that learns the room noise. A pause after "et",
  "parce que", "euh" or a comma waits for the rest of the sentence.
- **Interrupting**: talk over Judith and she stops to listen (`"interruptions": true`).
- **Cancelling**: the **X** button (or Esc) stops everything, whoever is talking, including
  Claude Code in the middle of an answer. The conversation memory is kept.
- **Follow-up**: after answering, Judith listens a few more seconds (`"conversation": true`).
