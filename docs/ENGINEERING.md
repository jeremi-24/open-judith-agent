# Engineering notes

How Judith is built, what protects the user, how it is tested, and where it is weak.
Everything here can be checked in the code; file names are given.

Judith was built with Claude Code as a pair programmer. The product choices, the tests on real screens and
the decisions are the author's.

## The path of one question

```
Ctrl+Alt+J ─► notch (renderer) ─► conversation manager (src/core/conversation.js)
                                        │ question + turn number
                                        ▼
            main process (src/main/main.js) ─► screenshot (capture.js)
                                        │ image + question, stream-json
                                        ▼
        Claude Code, kept warm (src/engine/claude-code.js) ─► Judith's MCP server (src/mcp/server.js)
                                        │ answer as a script of lines
                                        ▼
   script reader (src/core/script.js) ─► say  → voice (local Piper)
                                       ├ ring / box / arrow / underline → overlay window (hand-drawn ink)
                                       └ scene n → 3D board (three.js, sandboxed frame)
```

- **One conversation manager decides who talks and when** (`conversation.js`). The microphone, the speech
  recognition, Claude Code and the voice only report events to it. Each question has a turn number, and
  anything a cancelled turn still sends is ignored. This is what prevents echo loops, double answers and
  fights between the microphone and the voice.
- **Claude Code is kept warm** as a long-lived process spoken to over `stream-json`: a fresh process per
  question costs about 10 s. Cancelling interrupts the turn; if it does not stop quickly, the process is
  restarted on the same session so the conversation is kept.
- **Claude answers in a tiny line-based script** (`say`, `ring`, `box`, `arrow`, `underline`, `scene`,
  `zone`, `step`…) read as it streams in, so a drawing appears when her sentence about it starts.
- **Marks have a life cycle** (`src/core/pixels.js`, in `main.js`): a mark is true only for the screen she
  looked at. Tiny copies of the screen are compared on this PC; a mark follows its content when the page
  scrolls and disappears when its content changes.
- **Windows UI Automation** (`companions/eyes`, .NET Framework 4.8) gives the exact bounds of the control
  under a mark; `src/core/snap.js` picks the right one (overlap, name, kind of control). Without it, marks
  keep the model's position.

## Layout of the code

| Folder | Role |
|---|---|
| `src/core/` | Pure logic with no Electron: conversation, script, ink, snapping, pixels, guard, i18n |
| `src/engine/` | The Claude Code process |
| `src/main/` | Electron main process: windows, capture, voice, config, companions |
| `src/renderer/` | The pages: notch, overlay, board, welcome, 3D frame |
| `src/mcp/` | Judith's own MCP server (`look_at_screen`, `show_visual`, `show_scene`) |
| `companions/` | Two small Windows programs: `eyes` (UI Automation), `hands` (mouse and keyboard) |
| `test/` | Unit tests, run without Electron |

## What protects the user

- **Windows are isolated**: `sandbox`, `contextIsolation`, no Node in pages, a content-security policy on each page,
  and a narrow preload bridge (`src/main/preload.cjs`).
- **What the model writes runs in a sandboxed frame.** HTML visuals and 3D scene code are served from their own
  scheme (`judith-frame://`, `src/main/frames.js`) with a policy that allows no network. A 3D scene that hangs is
  stopped after 5 s and reported back to the model.
- **The local bridge** between Claude Code's tools and the app listens on `127.0.0.1` only, and every call must carry
  a random token (`src/main/bridge.js`).
- **Screenshots are never written to disk** and are sent only when the user asks.
- **The autonomous mode has guardrails that do not depend on the model** (`src/core/guard.js`, `src/core/pilot.js`):
  forbidden apps (terminals, password managers, system tools, Judith herself), confirmation before deleting,
  sending, paying or installing (judged on the real name of the control), no typing of passwords or card numbers,
  an allowed list of keys, limits on actions and steps, and a stop as soon as the mouse moves
  (enforced in the companion, `companions/hands`).
- **"Claude can act" is a choice with a cost**: when it is on, Claude Code runs with all its tools and no permission
  prompts. Text on a screen can carry instructions meant for the model. The prompt says only the user's words count;
  that is a mitigation, not a guarantee. It can be turned off in the settings.

## Tests and checks

- Unit tests in `test/` run with `npm test` and need no Electron: the logic is kept in `src/core` for that reason.
- The 3D scene code is tested in Node with the real three.js, through `vm`, with a fake renderer.
- A test fails when a sentence of the interface has no English version or an English entry is left over.
- A CI workflow (`.github/workflows/ci.yml`) runs the tests on Windows and Linux and builds both companions.

## Known limits

- Windows only. It needs Claude Code installed and logged in.
- The installer is not code-signed; Windows SmartScreen warns.
- Speed: a spoken turn takes from about 1.5 s (a short follow-up) to about 7–14 s (a screenshot, a long answer, a 3D model
  that had to be redone). Most of it is the model; speech-to-text adds about 2 s.
- The precision of marks depends on the model: the same screen is annotated further with a stronger model than with a small one.
- Content without accessible controls (video, canvas, some games) keeps the model's approximate position for marks.
- `src/main/main.js` is large and holds a lot of state. Splitting it by concern (voice, marks, agent, settings) is the next refactor.
