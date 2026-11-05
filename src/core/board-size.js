// How big Judith's board window is: it follows its content, in any shape.
// The board asks for a width and a height; the window gives them as far as
// the screen allows. When the content is taller than the screen, the board
// asks to become wider first (a wide shape rarely needs a scroll bar).
export const BOARD_MIN_WIDTH = 340;
export const BOARD_MAX_WIDTH = 760;
export const BOARD_MIN_HEIGHT = 80;
// Room kept around the window, and what the board draws around its frames
// (the page margin, the paper padding): a frame needs that much less width.
const SCREEN_MARGIN = 16;
export const BOARD_CHROME_WIDTH = 56;
const GROW_STEP = 120;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// request: { width, height } (either may be missing); area: the work area of the display.
export function fitBoard(request = {}, area = { width: 1280, height: 720 }) {
  const maxWidth = Math.max(BOARD_MIN_WIDTH, Math.min(BOARD_MAX_WIDTH, area.width - 2 * SCREEN_MARGIN));
  const maxHeight = Math.max(BOARD_MIN_HEIGHT, area.height - 2 * SCREEN_MARGIN);
  return {
    width: clamp(Math.ceil(Number(request.width) || BOARD_MIN_WIDTH), BOARD_MIN_WIDTH, maxWidth),
    height: clamp(Math.ceil(Number(request.height) || BOARD_MIN_HEIGHT), BOARD_MIN_HEIGHT, maxHeight),
  };
}

// The window width a frame of this natural width needs.
export const widthForFrame = (frameWidth) => Math.ceil(frameWidth) + BOARD_CHROME_WIDTH;

// The next width to try when the content does not fit the height: wider, never narrower,
// never past the maximum; null when it cannot grow any more.
export function widerWidth(current, room) {
  const max = Math.min(BOARD_MAX_WIDTH, room);
  return current >= max ? null : Math.min(max, current + GROW_STEP);
}
