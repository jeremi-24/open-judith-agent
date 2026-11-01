<p align="center">
  <img src="assets/icon.png" width="120" alt="Judith">
</p>

<h1 align="center">Judith Agent</h1>

<p align="center"><b>Claude Code sees your files. Judith sees your screen.</b><br>
<i>Je te montre, tu apprends.</i></p>

---

Judith is a desktop mentor for Windows. Press a shortcut, ask a question, and Judith
looks at your screen, **draws the answer right on top of your software** (rings,
arrows, numbered steps) and explains it, in any app: VS Code, CapCut, Blender, Excel…

She runs on **your own Claude Code**, so she shares its memory, skills and MCP
connectors. She already knows your projects and your level on day one.

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

- **Ask mode**: question → answer + drawing. Judith only shows (read-only).
- **Act mode**: Judith may also edit files through Claude Code (opt-in).
- **Session mode** *(planned)*: give her a goal, she guides you step by step, quizzes
  you and tracks what you have learned.

## Requirements

- Windows 10/11
- Node.js 22+
- [Claude Code](https://code.claude.com) installed and logged in (`claude` works in a terminal)

## Getting started

```bash
git clone https://github.com/jeremi-24/open-judith-agent.git
cd open-judith-agent
npm install
npm start
```

Then press **Ctrl + Alt + J** anywhere.

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
  "mode": "show",
  "hideFromScreenRecordings": true
}
```

- `workingDirectory` matters: Claude Code loads the memory and `CLAUDE.md` of that folder,
  so point it where you usually run `claude`. In JSON, write paths with `/` or `\\`.
- `mode`: `show` (read-only) or `act` (Claude Code may edit files). Also in the tray menu.
- `hideFromScreenRecordings`: keep `true` for privacy; set `false` to film demos with OBS.

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
- Text only for now: voice input and output are planned.

## Privacy

Screenshots are taken only when you press the shortcut, are sent to Claude through
your own Claude Code, and are never written to disk. Judith's own windows are excluded
from captures.

## License

MIT
