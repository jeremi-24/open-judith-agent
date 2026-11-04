// API keys, encrypted with Windows' own protection for the user's account
// (Electron safeStorage, DPAPI on Windows). They never go in config.json:
// keys.json only holds encrypted bytes, unreadable from another account or PC.
import { app, safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROVIDERS } from '../engine/api.js';

const file = () => join(app.getPath('userData'), 'keys.json');

function readAll() {
  try {
    return existsSync(file()) ? JSON.parse(readFileSync(file(), 'utf8')) : {};
  } catch {
    return {};
  }
}

export function setKey(provider, key) {
  if (!PROVIDERS[provider]) throw new Error(`Unknown provider: ${provider}`);
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Encryption is not available on this PC: the key was not saved.');
  const all = readAll();
  if (key) all[provider] = safeStorage.encryptString(key).toString('base64');
  else delete all[provider];
  writeFileSync(file(), JSON.stringify(all, null, 2));
}

// The saved key, else the provider's usual environment variable.
export function getKey(provider) {
  const saved = readAll()[provider];
  if (saved) {
    try {
      return safeStorage.decryptString(Buffer.from(saved, 'base64'));
    } catch {
      // Saved on another account or PC: unreadable here.
    }
  }
  return process.env[PROVIDERS[provider]?.env] || '';
}

export const hasKey = (provider) => Boolean(getKey(provider));
