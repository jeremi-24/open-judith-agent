import { desktopCapturer } from 'electron';

// Long edge sent to the model. Bigger costs more tokens without helping the
// model point more precisely (coordinates are fractions anyway).
const MAX_EDGE = 1568;

// Screenshot of one display, as base64 JPEG. Never written to disk.
export async function captureDisplay(display) {
  const { width, height } = display.size;
  const scale = display.scaleFactor;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) },
  });
  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
  if (!source) throw new Error('No screen to capture');

  let image = source.thumbnail;
  const size = image.getSize();
  const ratio = MAX_EDGE / Math.max(size.width, size.height);
  if (ratio < 1) {
    image = image.resize({ width: Math.round(size.width * ratio), height: Math.round(size.height * ratio), quality: 'best' });
  }
  return { mediaType: 'image/jpeg', data: image.toJPEG(85).toString('base64') };
}
