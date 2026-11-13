# How Judith is built

A plain tour of the code: how a question travels, what keeps the user safe, how it is tested, and what is still weak.
You can check everything here in the code. File names are given.

I built Judith with Claude Code as a pair programmer. The product choices, the tests on real screens and the decisions are mine.

## What happens when you ask a question

```
Ctrl+Alt+J ─► notch ─► conversation manager (src/core/conversation.js)
                              │ your question
                              ▼
        main process (src/main/main.js) ─► takes a screenshot (capture.js)
                              │ image + question
                              ▼
        Claude Code, kept running (src/engine/claude-code.js)
                  │ may call Judith's own tools through MCP (src/mcp/server.js)
                  ▼
        answer, written as short script lines (src/core/script.js)
           ├─ say                          → her voice (local Piper)
           ├─ ring / box / arrow / underline → drawn on your screen
           └─ scene n                       → a 3D model that builds up
```

In short:

- **One part decides who talks and when.** It is `conversation.js`. The microphone, speech recognition, Claude Code
  and the voice only tell it what happened. Every question has a number, and anything a cancelled question still
  sends is ignored. That is how I avoid echo loops, double answers and the mic fighting the voice.
- **Claude Code stays running.** Starting a new one for each question takes about 10 seconds. Judith keeps one open and
  talks to it over `stream-json`. If you cancel and it does not stop fast, she restarts it on the same session, so the
  conversation is not lost.
- **Claude answers with a few simple lines** (`say`, `ring`, `box`, `arrow`, `underline`, `scene`…). Judith reads them
  while they stream in, so a drawing shows up when she starts the sentence about it.
- **Drawings only stay while they are true.** Judith compares small copies of the screen. If the page scrolls, the
  drawing follows it. If the content changes, it disappears.
- **Marks snap to the real buttons.** A small Windows helper (`companions/eyes`) asks Windows for the exact size of the
  control under a mark, so a ring lands on the real button and not 30 pixels away.

## The MCP server

MCP is the way Claude Code gets extra tools. Judith has her own small MCP server (`src/mcp/server.js`). Claude Code
starts it by itself when Judith runs, so the user sets up nothing.

It gives Claude three tools:

- `look_at_screen`: take a screenshot when the answer depends on what is on the screen.
- `show_visual`: show a diagram or a page next to the screen.
- `show_scene`: build a 3D model, step by step.

The server does not touch your screen itself. It calls a small local server inside the app (`src/main/bridge.js`),
which only listens on `127.0.0.1` and needs a random token on every call.

```
Claude Code ─► Judith's MCP server ─► local bridge (127.0.0.1 + token) ─► the app
```

## Where things are

| Folder | What is in it |
|---|---|
| `src/core/` | The logic, with no Electron: conversation, script, drawing, snapping, guardrails, translations |
| `src/engine/` | The Claude Code process |
| `src/main/` | The Electron side: windows, screenshots, voice, settings, the helpers |
| `src/renderer/` | The pages: notch, drawing layer, board, welcome screens, 3D frame |
| `src/mcp/` | Judith's MCP server |
| `companions/` | Two small Windows programs: `eyes` (finds real buttons) and `hands` (mouse and keyboard) |
| `test/` | Unit tests, no Electron needed |

## What keeps the user safe

- **Pages are isolated.** Sandbox on, no Node in the pages, a content policy on each page, and a very small bridge
  to the app (`src/main/preload.cjs`).
- **Code written by the model runs in a locked box.** HTML visuals and 3D scene code are served from their own scheme
  (`judith-frame://`, `src/main/frames.js`) with a policy that allows no network. A 3D scene that freezes is stopped
  after 5 seconds and the model is told.
- **The local bridge is private.** It is on `127.0.0.1` only and every call needs the token.
- **Screenshots are never saved to disk.** They are sent only when you ask something.
- **The autonomous mode has guardrails that do not trust the model** (`src/core/guard.js`, `src/core/pilot.js`).
  She never works in terminals, password managers or system tools. She asks before deleting, sending, paying or
  installing (judged on the real name of the control). She never types passwords or card numbers. She uses a short
  list of keys. She has a limit on actions. She stops as soon as you move the mouse, and that last check is inside the
  helper program (`companions/hands`), not in the model.
- **"Claude can act" has a real cost.** When it is on, Claude Code runs with all its tools and no permission prompts.
  Text on a screen can contain instructions aimed at the model. Judith's prompt says only the user's words count, but
  that helps, it does not guarantee anything. You can turn it off in the settings.

## Tests

- `npm test` runs the unit tests. They do not need Electron, because the logic lives in `src/core`.
- The 3D code is tested in Node with the real three.js and a fake renderer.
- A test fails if a sentence in the interface has no English version.
- A CI workflow (`.github/workflows/ci.yml`) runs the tests on Windows and Linux and builds both helpers.

## What is still weak

- Windows only, and Claude Code must be installed and logged in.
- The installer is not signed, so Windows SmartScreen shows a warning.
- Speed: an answer takes from about 1.5 seconds (a short follow-up) to 7 to 14 seconds (a screenshot, a long answer,
  or a 3D model that had to be redone). Most of that time is the model. Speech recognition adds about 2 seconds.
- Drawing precision depends on the model. A stronger model annotates a screen further than a small one.
- On content without real controls (video, canvas, some games), marks keep the model's rough position.
- `src/main/main.js` is too big and holds too much state. Splitting it (voice, marks, agent, settings) is the next cleanup.
