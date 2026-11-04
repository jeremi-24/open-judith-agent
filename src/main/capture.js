import { desktopCapturer } from 'electron';
import { zonePixels } from '../core/zone.js';

// Long edge sent to the model. Bigger costs more tokens without helping the
// model point more precisely (coordinates are fractions anyway).
const MAX_EDGE = 1568;
// Long edge of the tiny copies used to notice that the screen changed.
const SMALL_EDGE = 480;

async function grab(display, width, height) {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } });
  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
  if (!source) throw new Error('No screen to capture');
  return source.thumbnail;
}

function toSmall(image) {
  const size = image.getSize();
  const ratio = SMALL_EDGE / Math.max(size.width, size.height);
  const small = image.resize({ width: Math.round(size.width * ratio), height: Math.round(size.height * ratio) });
  const { width, height } = small.getSize();
  return { data: small.toBitmap(), width, height };
}

// Screenshot of one display, as base64 JPEG, plus a tiny raw copy to compare
// with later. Never written to disk.
// zone: only that part of the display is sent (the tiny copy stays whole).
export async function captureDisplay(display, zone = null) {
  const { width, height } = display.size;
  const scale = display.scaleFactor;
  let image = await grab(display, Math.round(width * scale), Math.round(height * scale));
  const small = toSmall(image);
  if (zone) image = image.crop(zonePixels(zone, image.getSize()));
  const size = image.getSize();
  const ratio = MAX_EDGE / Math.max(size.width, size.height);
  if (ratio < 1) {
    image = image.resize({ width: Math.round(size.width * ratio), height: Math.round(size.height * ratio), quality: 'best' });
  }
  return { mediaType: 'image/jpeg', data: image.toJPEG(85).toString('base64'), small };
}

// Several zones: one screenshot of the display, cut once per zone.
// → { images: [{ mediaType, data }] }
export async function captureZones(display, zones) {
  const { width, height } = display.size;
  const scale = display.scaleFactor;
  const full = await grab(display, Math.round(width * scale), Math.round(height * scale));
  const images = zones.map((zone) => {
    let image = full.crop(zonePixels(zone, full.getSize()));
    const size = image.getSize();
    const ratio = MAX_EDGE / Math.max(size.width, size.height);
    if (ratio < 1) image = image.resize({ width: Math.round(size.width * ratio), height: Math.round(size.height * ratio), quality: 'best' });
    return { mediaType: 'image/jpeg', data: image.toJPEG(85).toString('base64') };
  });
  return { images };
}

// A small picture of one zone (a data URL), for the numbered thumbnails.
const THUMB_EDGE = 160;
export async function captureThumb(display, zone) {
  const scale = display.scaleFactor;
  const full = await grab(display, Math.round(display.size.width * scale), Math.round(display.size.height * scale));
  let image = full.crop(zonePixels(zone, full.getSize()));
  const size = image.getSize();
  const ratio = THUMB_EDGE / Math.max(size.width, size.height);
  if (ratio < 1) image = image.resize({ width: Math.max(1, Math.round(size.width * ratio)), height: Math.max(1, Math.round(size.height * ratio)) });
  return `data:image/jpeg;base64,${image.toJPEG(70).toString('base64')}`;
}

// A screenshot to keep or share: full resolution, as a NativeImage.
export async function captureFull(display, zone = null) {
  const scale = display.scaleFactor;
  const image = await grab(display, Math.round(display.size.width * scale), Math.round(display.size.height * scale));
  return zone ? image.crop(zonePixels(zone, image.getSize())) : image;
}

// Only the tiny copy: cheap enough to check the screen every second.
export async function captureSmall(display) {
  const ratio = SMALL_EDGE / Math.max(display.size.width, display.size.height);
  const image = await grab(display, Math.round(display.size.width * ratio), Math.round(display.size.height * ratio));
  const { width, height } = image.getSize();
  return { data: image.toBitmap(), width, height };
}
