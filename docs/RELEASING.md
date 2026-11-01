# Releasing Judith

The installer is built locally with two small tools, downloaded once into `.tools/`
(ignored by git, about 5 MB):

| Tool | File | Source |
| --- | --- | --- |
| rcedit 2.0.0 | `.tools/rcedit-x64.exe` | https://github.com/electron/rcedit/releases |
| NSIS 3.10 | `.tools/nsis/nsis-3.10/makensis.exe` (unzipped) | https://nsis.sourceforge.io |

Electron itself is not downloaded again: the build reuses `node_modules/electron/dist`.

## Build

```bash
npm test
npm run dist
```

`dist/Judith/` is the app as it will be installed (try `dist/Judith/Judith.exe` before
publishing); `dist/Judith-Setup-<version>.exe` is the installer.

What the build leaves out: other platforms' ONNX engines, the browser WebAssembly builds,
source maps and Electron's languages other than French and English.

## Publish

1. Bump `version` in `package.json` and add the notes to `CHANGELOG.md`.
2. Merge everything into `main`.
3. Tag and publish (GitHub CLI, logged in once with `gh auth login`):

```bash
git tag -a v0.1.0 -m "Judith 0.1.0"
git push origin v0.1.0
gh release create v0.1.0 dist/Judith-Setup-0.1.0.exe --title "Judith 0.1.0" --notes-file <notes>
```

The installer is not code-signed: Windows SmartScreen shows "Windows protected your PC";
users click **More info → Run anyway**.
