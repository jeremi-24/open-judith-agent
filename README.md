<p align="center">
  <img src="assets/icon.png" width="120" alt="Judith">
</p>

<h1 align="center">Judith</h1>

<p align="center"><b>Press a shortcut. Judith sees your screen and answers on it.</b><br>
<i>Je te montre, tu apprends.</i></p>

<p align="center">
  <a href="https://github.com/jeremi-24/open-judith-agent/releases/latest"><b>Download for Windows</b></a>
  · <a href="docs/FEATURES.md">What she can do</a>
  · <a href="docs/CONFIG.md">Configuration</a>
</p>

<!-- A short GIF of Judith at work goes here. -->

Judith is a small assistant that lives in a notch at the top of your screen. No chat app to open:
you press **Ctrl + Alt + J**, ask out loud, and she answers right on top of what you are doing,
in any app.

## What she does

- **Sees your screen**: the whole screen, or up to 4 zones you draw, that she can compare.
- **Marks it**: hand-drawn rings, boxes, arrows and underlines, one for each sentence she says.
- **Illustrates in 3D**: a model that builds up part by part while she explains.
- **Follows you**: say "Agent, …" and she guides you step by step to the end of a task.
- **Acts for you**: light tasks on your PC (files, commands, browser) without opening another app.
  On by default, and it can be turned off (see [Privacy and safety](#privacy-and-safety)).
- **Talks with you**: local speech recognition and a local voice; you can interrupt her.

French and English, chosen from the language of Windows. Details in [docs/FEATURES.md](docs/FEATURES.md).

## Install

You need Windows 10/11 and [Claude Code](https://code.claude.com) installed and logged in
(`claude` works in a terminal): Judith thinks with it, so she shares its memory, skills and connectors.

1. Download `Judith-Setup-<version>.exe` from the
   [latest release](https://github.com/jeremi-24/open-judith-agent/releases/latest).
2. Run it. The installer is not code-signed yet, so Windows SmartScreen may say
   "Windows protected your PC": click **More info → Run anyway**.
3. Judith starts. Press **Ctrl + Alt + J** anywhere.

What the installer does: it installs for your account only (no admin rights) in
`%LOCALAPPDATA%\Programs\Judith`, adds Start menu and desktop shortcuts, and makes Judith start with
Windows (switch it off in the welcome window or the tray menu). On first use she downloads her
speech model (about 80 MB) and her voice (about 65 MB), once. Uninstall from **Settings → Apps**; your
settings and diary stay in `%APPDATA%\open-judith-agent`.

## Privacy and safety

- A screenshot is sent only when you ask something: it goes to Claude through your own Claude Code,
  and is never written to disk. Her own windows are excluded from captures.
- Between two steps of agent mode, and while marks are on the screen, she compares tiny copies of the
  screen **on this PC** to notice that it changed. They are never sent or saved.
- `journal.jsonl` in her data folder keeps one line per question (the question, the tools used, the
  timings), on this PC only. Turn it off with `"journal": false` in `config.json`.
- **"Claude can act" is on by default**: Claude Code then runs with all its tools and **without
  permission prompts**. Text on the screen can carry instructions meant for the model, and her
  prompt tells her that only your words count, which is not a guarantee. Switch it off in the
  notch's settings (gear) when you look at things you do not trust: she then only looks and explains.
- The optional cloud voices send your voice or her sentences to those services, and their keys are
  stored in clear text in `config.json`.

## More

- [What she can do, in detail](docs/FEATURES.md) · [Configuration](docs/CONFIG.md) ·
  [Adding a language](docs/I18N.md) · [Building a release](docs/RELEASING.md)

## Run from source

Requires Node.js 22+.

```bash
git clone https://github.com/jeremi-24/open-judith-agent.git
cd open-judith-agent
npm install
npm start
```

```bash
npm test                                   # unit tests (no Electron needed)
node scripts/try-engine.mjs "question" img.png   # talk to her from the terminal
```

## Credits

- Voice: [Piper](https://github.com/rhasspy/piper) `fr_FR-siwis-medium`, trained on the
  [SIWIS French Speech Synthesis Database](https://datashare.is.ed.ac.uk/handle/10283/2353)
  (CC BY 4.0), run with [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache-2.0).
- English voice: Piper `en_US-kristin-medium`, trained on a [LibriVox](https://librivox.org)
  recording (public domain).
- Speech recognition: [Whisper](https://github.com/openai/whisper) through
  [Transformers.js](https://github.com/huggingface/transformers.js).

## License

MIT. Judith is an independent project, not affiliated with Anthropic.
