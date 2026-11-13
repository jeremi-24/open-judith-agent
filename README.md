<p align="center">
  <img src="assets/icon.png" width="110" alt="Judith">
</p>

<h1 align="center">Judith</h1>

<p align="center"><b>Judith looks at your screen, sends it to Claude, and answers right on top of it.</b></p>

<p align="center">
  <a href="https://github.com/jeremi-24/open-judith-agent/releases/latest"><b>Download for Windows</b></a>
</p>

<p align="center">
  <img src="assets/readme/listening.jpg" alt="Judith's notch at the top of the screen, listening" width="820">
</p>

You press a shortcut, ask a question out loud (or type it), and Judith answers on your screen.
No chat app to open.

## How it works

1. **You ask.** Press **Ctrl + Alt + J** anywhere and speak. Judith's notch opens at the top of the screen.
2. **Judith looks.** She takes a screenshot of your screen (or of up to 4 zones you draw) and sends it
   with your question to **Claude, through your own Claude Code**.
3. **She answers on your screen.** Claude's answer is spoken, and drawn on top of what you see:
   rings, arrows and underlines on the right things, or a small 3D model that builds up as she explains.

<p align="center">
  <img src="assets/readme/balloon-3d.jpg" alt="Judith explaining how a hot air balloon flies, with a 3D model built part by part" width="820">
</p>

She can also do light tasks on your PC when you ask (files, commands, browser). That is on by default and
can be turned off in the settings (the gear in the notch): see [Privacy and safety](#privacy-and-safety).

French and English, chosen from the language of Windows.

## Install

You need Windows 10/11 and [Claude Code](https://code.claude.com) installed and logged in
(`claude` works in a terminal). Judith thinks with it, so she shares its memory and skills.

1. Download `Judith-Setup-<version>.exe` from the
   [latest release](https://github.com/jeremi-24/open-judith-agent/releases/latest).
2. Run it. The installer is not code-signed yet, so Windows SmartScreen may say
   "Windows protected your PC": click **More info → Run anyway**.
3. Judith starts. Press **Ctrl + Alt + J**.

It installs for your account only (no admin rights) and starts with Windows (you can turn that off in the
welcome window or the tray menu). On first use she downloads her speech model (about 80 MB) and her
voice (about 65 MB), once. Uninstall from **Settings → Apps**; your settings stay in
`%APPDATA%\open-judith-agent`.

## Privacy and safety

- A screenshot is sent only when you ask something. It goes to Claude through your own Claude Code and is
  never written to disk. Judith's own windows are left out of captures.
- Speech recognition and her voice run on your PC. A diary of your questions (`journal.jsonl`) stays on
  your PC too; turn it off with `"journal": false` in `config.json`.
- **"Claude can act" is on by default**: Claude Code then runs with all its tools and **without permission
  prompts**. Text on a screen can carry instructions meant for the model, and Judith's prompt says that only
  your words count, which is not a guarantee. Switch it off in the settings if you look at things you do not
  trust: she then only looks and explains.

## More

[What she can do](docs/FEATURES.md) · [Configuration](docs/CONFIG.md) · [Adding a language](docs/I18N.md) ·
[Building a release](docs/RELEASING.md)

To run it from the sources (Node.js 22+): `git clone`, `npm install`, `npm start`.

## Credits

Judith was built independently. The idea of an AI buddy that sees your screen was made popular by
[Clicky / HeyClicky](https://github.com/farzaa/clicky) (MIT), whose open-source version is for macOS.

- Voice: [Piper](https://github.com/rhasspy/piper) `fr_FR-siwis-medium` (trained on the
  [SIWIS database](https://datashare.is.ed.ac.uk/handle/10283/2353), CC BY 4.0) and `en_US-kristin-medium`
  (a public-domain LibriVox recording), run with [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache-2.0).
- Speech recognition: [Whisper](https://github.com/openai/whisper) through
  [Transformers.js](https://github.com/huggingface/transformers.js).

## License

MIT. Judith is an independent project, not affiliated with Anthropic.
