// How big Judith's board window is: it follows its content, but never takes
// the screen. The board asks for a width and a height; the window gives them
// up to a share of the screen (the user's own app stays the main thing), and
// past that the paper scrolls. When the content is too tall, the board asks to
// become wider first (a wide shape rarely needs a scroll bar).
export const BOARD_MIN_WIDTH = 320;
export const BOARD_MAX_WIDTH = 640;
export const BOARD_MIN_HEIGHT = 56;
// The share of the work area the board may cover, at most.
export const BOARD_SHARE = { width: 0.42, height: 0.62 };
// What the board draws around its frames (the page margin, the paper
// padding): a frame needs that much less width.
export const BOARD_CHROME_WIDTH = 56;
const GROW_STEP = 120;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// The widest and tallest the board may be on a work area of that size.
export const maxBoardWidth = (areaWidth) => clamp(Math.floor(areaWidth * BOARD_SHARE.width), BOARD_MIN_WIDTH, BOARD_MAX_WIDTH);
export const maxBoardHeight = (areaHeight) => Math.max(BOARD_MIN_HEIGHT, Math.floor(areaHeight * BOARD_SHARE.height));

// request: { width, height } (either may be missing); area: the work area of the display.
export function fitBoard(request = {}, area = { width: 1280, height: 720 }) {
  return {
    width: clamp(Math.ceil(Number(request.width) || BOARD_MIN_WIDTH), BOARD_MIN_WIDTH, maxBoardWidth(area.width)),
    height: clamp(Math.ceil(Number(request.height) || BOARD_MIN_HEIGHT), BOARD_MIN_HEIGHT, maxBoardHeight(area.height)),
  };
}

// The window width a frame of this natural width needs.
export const widthForFrame = (frameWidth) => Math.ceil(frameWidth) + BOARD_CHROME_WIDTH;

// The next width to try when the content does not fit the height: wider, never narrower,
// never past the maximum (max: maxBoardWidth of the screen); null when it cannot grow any more.
export function widerWidth(current, max = BOARD_MAX_WIDTH) {
  const limit = Math.min(BOARD_MAX_WIDTH, max);
  return current >= limit ? null : Math.min(limit, current + GROW_STEP);
}
