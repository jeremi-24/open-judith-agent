// Audio helpers that do not need the speech model.

// Whisper does not know Judith: "J'udite", "Judite", "Judit"… become "Judith".
export function fixName(text) {
  return String(text ?? '')
    .replace(/\b(?:j'\s?)?ju?dit(?:h|e|te)?\b/gi, 'Judith')
    .replace(/\bJ'udi?te?\b/gi, 'Judith')
    .trim();
}

// 16-bit PCM WAV → Float32Array (cloud voices, tests, the CLI).
export function decodeWav(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 12;
  let format = null;
  while (offset + 8 <= view.byteLength) {
    const id = String.fromCharCode(...buffer.subarray(offset, offset + 4));
    // Streamed WAVs may announce a wrong (huge or zero) data size: trust the bytes.
    const announced = view.getUint32(offset + 4, true);
    const size = id === 'data' && (announced === 0 || offset + 8 + announced > view.byteLength) ? view.byteLength - offset - 8 : announced;
    if (id === 'fmt ') format = { channels: view.getUint16(offset + 10, true), rate: view.getUint32(offset + 12, true), bits: view.getUint16(offset + 22, true) };
    if (id === 'data' && format?.bits === 16) {
      const samples = new Float32Array(Math.floor(size / 2 / format.channels));
      for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(offset + 8 + i * 2 * format.channels, true) / 32768;
      return { samples, rate: format.rate };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('Unsupported WAV file (16-bit PCM expected)');
}
