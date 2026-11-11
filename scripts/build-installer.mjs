// Builds dist/Judith-Setup-<version>.exe, a per-user Windows installer:
// Electron's own runtime renamed Judith.exe with Judith's icon, the app and
// its production dependencies, packed by NSIS. No admin rights needed.
//
// Tools, downloaded once into .tools/ (not in git, see docs/RELEASING.md):
//   .tools/rcedit-x64.exe                 icon and version info of Judith.exe
//   .tools/nsis/nsis-3.10/makensis.exe    the installer
// Usage: npm run dist
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join, relative, sep } from 'node:path';
import sharp from 'sharp';

const root = join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const out = join(root, 'dist');
const appDir = join(out, 'Judith'); // the installed folder, as it will be
const RCEDIT = join(root, '.tools', 'rcedit-x64.exe');
const MAKENSIS = join(root, '.tools', 'nsis', 'nsis-3.10', 'makensis.exe');
const APP_ID = 'com.jeremi24.judith';

for (const tool of [RCEDIT, MAKENSIS]) {
  if (!existsSync(tool)) throw new Error(`Missing ${relative(root, tool)}: see docs/RELEASING.md`);
}

const step = (text) => console.log(`\n▸ ${text}`);
const size = (path) => {
  let total = 0;
  const walk = (p) => {
    const s = statSync(p);
    if (s.isDirectory()) for (const name of readdirSafe(p)) walk(join(p, name));
    else total += s.size;
  };
  walk(path);
  return `${(total / 1024 / 1024).toFixed(0)} Mo`;
};
const readdirSafe = (p) => {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
};

// ----- 1. Electron's runtime, renamed -----
step('Electron → Judith.exe');
rmSync(appDir, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const electronDist = join(root, 'node_modules', 'electron', 'dist');
const KEEP_LOCALES = new Set(['fr.pak', 'en-US.pak']);
cpSync(electronDist, appDir, {
  recursive: true,
  filter: (src) => {
    const rel = relative(electronDist, src);
    if (rel === join('resources', 'default_app.asar')) return false;
    if (rel.startsWith(`locales${sep}`)) return KEEP_LOCALES.has(basename(src));
    return true;
  },
});
renameSync(join(appDir, 'electron.exe'), join(appDir, 'Judith.exe'));

// ----- 2. The app and its production dependencies -----
step('App + dependencies');
const app = join(appDir, 'resources', 'app');
mkdirSync(app, { recursive: true });
const { devDependencies, scripts, ...appPkg } = pkg;
writeFileSync(join(app, 'package.json'), JSON.stringify(appPkg, null, 2));
for (const item of ['src', 'assets', 'LICENSE']) {
  if (existsSync(join(root, item))) cpSync(join(root, item), join(app, item), { recursive: true });
}

// Native companions, built with the .NET SDK when it is installed. Without
// them Judith still works: marks keep the model's position (eyes), and the
// autonomous agent mode is unavailable (hands).
const COMPANIONS = [
  ['eyes', 'UI Automation', 'marks will not snap onto controls'],
  ['hands', 'autonomous agent mode', 'the autonomous agent mode will be unavailable'],
];
for (const [name, role, without] of COMPANIONS) {
  const exe = join(root, 'companions', name, 'bin', 'Release', 'net48', `judith-${name}.exe`);
  try {
    execFileSync('dotnet', ['build', join(root, 'companions', name), '-c', 'Release', '--nologo', '-v', 'q'], { stdio: 'inherit' });
  } catch {
    console.warn(`  ! .NET SDK not found or build failed: judith-${name}.exe not rebuilt`);
  }
  if (existsSync(exe)) {
    mkdirSync(join(app, 'companions'), { recursive: true });
    cpSync(exe, join(app, 'companions', `judith-${name}.exe`));
    console.log(`  + judith-${name}.exe (${role})`);
  } else {
    console.warn(`  ! judith-${name}.exe missing: ${without}`);
  }
}

// Production packages only (npm knows which), top-level folders.
const listed = execFileSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], { cwd: root, encoding: 'utf8', shell: true })
  .split(/\r?\n/)
  .map((line) => relative(root, line.trim()))
  .filter((rel) => rel.startsWith(`node_modules${sep}`));
const packages = new Set(
  listed.map((rel) => {
    const parts = rel.split(sep);
    return parts.slice(0, parts[1].startsWith('@') ? 3 : 2).join(sep);
  }),
);
// What Judith never loads on Windows x64: other platforms' ONNX engines, the
// browser's WebAssembly builds, source maps.
const skip = (rel) =>
  rel.endsWith('.map') ||
  /onnxruntime-node[\\/]bin[\\/]napi-v\d+[\\/](darwin|linux)/.test(rel) ||
  /onnxruntime-node[\\/]bin[\\/]napi-v\d+[\\/]win32[\\/]arm64/.test(rel) ||
  /onnxruntime-web[\\/]dist[\\/].*\.wasm$/.test(rel) ||
  // three.js: the 3D scene frame loads build/three.min.js only (~30 MB less).
  (/^node_modules[\\/]three[\\/]/.test(rel) && !/^node_modules[\\/]three([\\/](package\.json|LICENSE|build([\\/]three\.min\.js)?))?$/.test(rel));
for (const pkgDir of packages) {
  cpSync(join(root, pkgDir), join(app, pkgDir), { recursive: true, filter: (src) => !skip(relative(root, src)) });
}
console.log(`  ${packages.size} packages, folder ${size(appDir)}`);

// ----- 3. The icon: rounded corners made transparent, every Windows size -----
step('Icon');
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const mask = Buffer.from('<svg width="480" height="480"><rect x="3" y="3" width="474" height="474" rx="104" fill="#fff"/></svg>');
const rounded = await sharp(join(root, 'assets', 'icon.png'))
  .ensureAlpha()
  .composite([{ input: mask, blend: 'dest-in' }])
  .png()
  .toBuffer();
const images = await Promise.all(SIZES.map((s) => sharp(rounded).resize(s, s).png().toBuffer()));
// An .ico file: a header, one entry per size, then the PNG images.
const header = Buffer.alloc(6 + 16 * SIZES.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(SIZES.length, 4);
let offset = header.length;
SIZES.forEach((s, i) => {
  const at = 6 + 16 * i;
  header.writeUInt8(s === 256 ? 0 : s, at);
  header.writeUInt8(s === 256 ? 0 : s, at + 1);
  header.writeUInt16LE(1, at + 4); // planes
  header.writeUInt16LE(32, at + 6); // bits per pixel
  header.writeUInt32LE(images[i].length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += images[i].length;
});
const ico = join(out, 'judith.ico');
writeFileSync(ico, Buffer.concat([header, ...images]));
writeFileSync(join(app, 'assets', 'icon-rounded.png'), await sharp(rounded).resize(256, 256).png().toBuffer());

// ----- 4. Judith.exe: icon and version info -----
step('Judith.exe: icon, name, version');
const fileVersion = `${version}.0`;
execFileSync(RCEDIT, [
  join(appDir, 'Judith.exe'),
  '--set-icon', ico,
  '--set-file-version', fileVersion,
  '--set-product-version', fileVersion,
  '--set-version-string', 'ProductName', 'Judith',
  '--set-version-string', 'FileDescription', 'Judith',
  '--set-version-string', 'CompanyName', 'jeremi-24',
  '--set-version-string', 'LegalCopyright', 'MIT License, jeremi-24',
  '--set-version-string', 'OriginalFilename', 'Judith.exe',
  '--set-version-string', 'InternalName', 'Judith',
]);

// ----- 5. The installer -----
step('Installer (NSIS, a few minutes: everything is compressed)');
const setup = join(out, `Judith-Setup-${version}.exe`);
const nsi = join(out, 'installer.nsi');
writeFileSync(nsi, installerScript({ version, appDir, ico, setup }), 'utf8');
execFileSync(MAKENSIS, ['/V2', nsi], { stdio: 'inherit' });
console.log(`\n✓ ${relative(root, setup)} (${size(setup)})`);

// Per-user install in %LOCALAPPDATA%\Programs\Judith (no admin), Start menu
// and desktop shortcuts, an entry in "Apps & features". The fixed folder
// keeps the uninstaller from ever deleting a folder the user chose.
// User data (%APPDATA%\open-judith-agent: config, keys, journal, models)
// is kept on uninstall.
function installerScript({ version, appDir, ico, setup }) {
  const UNINST = 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Judith';
  return `Unicode true
!include "MUI2.nsh"
Name "Judith"
OutFile "${setup}"
InstallDir "$LOCALAPPDATA\\Programs\\Judith"
RequestExecutionLevel user
SetCompressor /SOLID lzma
VIProductVersion "${version}.0"
VIAddVersionKey "ProductName" "Judith"
VIAddVersionKey "FileDescription" "Judith installer"
VIAddVersionKey "CompanyName" "jeremi-24"
VIAddVersionKey "LegalCopyright" "MIT License, jeremi-24"
VIAddVersionKey "FileVersion" "${version}"
VIAddVersionKey "ProductVersion" "${version}"

!define MUI_ICON "${ico}"
!define MUI_UNICON "${ico}"
!define MUI_FINISHPAGE_RUN "$INSTDIR\\Judith.exe"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "French"
!insertmacro MUI_LANGUAGE "English"

Section "Judith"
  nsExec::Exec 'taskkill /IM Judith.exe /F'
  Sleep 500
  RMDir /r "$INSTDIR\\resources"
  SetOutPath "$INSTDIR"
  File /r "${appDir}\\*"
  WriteUninstaller "$INSTDIR\\Uninstall Judith.exe"
  CreateShortcut "$SMPROGRAMS\\Judith.lnk" "$INSTDIR\\Judith.exe"
  CreateShortcut "$DESKTOP\\Judith.lnk" "$INSTDIR\\Judith.exe"
  WriteRegStr HKCU "${UNINST}" "DisplayName" "Judith"
  WriteRegStr HKCU "${UNINST}" "DisplayVersion" "${version}"
  WriteRegStr HKCU "${UNINST}" "Publisher" "jeremi-24"
  WriteRegStr HKCU "${UNINST}" "DisplayIcon" "$INSTDIR\\Judith.exe"
  WriteRegStr HKCU "${UNINST}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST}" "UninstallString" '"$INSTDIR\\Uninstall Judith.exe"'
  WriteRegStr HKCU "${UNINST}" "URLInfoAbout" "https://github.com/jeremi-24/open-judith-agent"
  WriteRegDWORD HKCU "${UNINST}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /IM Judith.exe /F'
  Sleep 500
  Delete "$SMPROGRAMS\\Judith.lnk"
  Delete "$DESKTOP\\Judith.lnk"
  DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "${APP_ID}"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINST}"
SectionEnd
`;
}
