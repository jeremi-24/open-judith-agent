// Downloads a model archive once into the user data folder.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Piper voices packaged for sherpa-onnx (model + tokens + espeak-ng data).
export const VOICES = {
  siwis: {
    folder: 'vits-piper-fr_FR-siwis-medium',
    model: 'fr_FR-siwis-medium.onnx',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-fr_FR-siwis-medium.tar.bz2',
  },
  // Kristin: LibriVox recording, public domain.
  kristin: {
    folder: 'vits-piper-en_US-kristin-medium',
    model: 'en_US-kristin-medium.onnx',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-kristin-medium.tar.bz2',
  },
};

// The local voice that speaks a language (Siwis is French only).
export const LOCAL_VOICE_FOR = { fr: 'siwis', en: 'kristin' };
export const localVoiceFor = (language) => LOCAL_VOICE_FOR[language] ?? LOCAL_VOICE_FOR.fr;

function extract(archive, into) {
  return new Promise((resolve, reject) => {
    // Windows 10+ ships bsdtar, which reads .tar.bz2. Call it by its full path:
    // a GNU tar on the PATH (Git Bash) would read "C:" as a remote host.
    const bin = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    const tar = spawn(bin, ['-xjf', archive, '-C', into], { windowsHide: true, stdio: 'ignore' });
    tar.on('error', reject);
    tar.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tar exited with ${code}`))));
  });
}

// Returns the folder of the voice, downloading it on first use (~65 MB).
export async function ensureVoice(name, modelsDir) {
  const voice = VOICES[name];
  if (!voice) throw new Error(`Unknown voice "${name}"`);
  const folder = join(modelsDir, voice.folder);
  if (existsSync(join(folder, voice.model))) return { ...voice, path: folder };

  // Extract next to the final folder, then rename: a download cut halfway
  // (app closed, network lost) never leaves a broken voice behind.
  const temp = join(modelsDir, `.download-${voice.folder}`);
  const archive = join(modelsDir, `${voice.folder}.tar.bz2`);
  for (const stale of [temp, archive, folder]) rmSync(stale, { recursive: true, force: true });
  mkdirSync(temp, { recursive: true });

  try {
    const response = await fetch(voice.url);
    if (!response.ok) throw new Error(`Voice download failed (${response.status})`);
    writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
    await extract(archive, temp);
    renameSync(join(temp, voice.folder), folder);
  } finally {
    rmSync(archive, { force: true });
    rmSync(temp, { recursive: true, force: true });
  }
  return { ...voice, path: folder };
}
