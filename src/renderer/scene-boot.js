// Boots the scene frame: waits for the board to send the model's code, runs
// it on a fresh stage, tells the board whether it worked, then animates.
// Messages are accepted from the parent (the board) only.
const canvas = document.getElementById('view');
const layer = document.getElementById('labels');
const bar = document.getElementById('bar');
const caption = document.getElementById('caption');
const count = document.getElementById('count');
const failed = document.getElementById('error');
const reply = (data) => parent.postMessage({ judithScene: data }, '*');

let stage = null;

function start(code) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (error) {
    failed.hidden = false;
    return reply({ ok: false, error: `WebGL is not available here (${error.message}).` });
  }
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  const width = canvas.clientWidth || 320;
  const height = canvas.clientHeight || 300;
  renderer.setSize(width, height, false);

  stage = JudithStage.createStage(THREE, { renderer, width, height, labelLayer: layer });
  stage.onStep = (i, total, text) => {
    bar.hidden = false;
    caption.textContent = text;
    count.textContent = `${i + 1}/${total}`;
  };
  stage.onError = (error) => reply({ warning: `${error.name}: ${error.message}` });
  const result = JudithStage.runScene(THREE, JudithBricks.makeJ(THREE), stage, code);
  reply(result);
  if (!result.ok) {
    failed.hidden = false;
    return;
  }

  let last = performance.now();
  const loop = (now) => {
    stage.tick(now / 1000, Math.min(0.1, (now - last) / 1000));
    last = now;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  new ResizeObserver(() => stage.resize(canvas.clientWidth, canvas.clientHeight)).observe(canvas);
}

window.addEventListener('message', (event) => {
  if (event.source !== parent || !event.data) return;
  if (typeof event.data.judithCode === 'string' && !stage) start(event.data.judithCode);
  if (Number.isInteger(event.data.judithStep)) stage?.drive(event.data.judithStep);
});

// Turn the model with the pointer, zoom with the wheel.
let dragging = null;
canvas.addEventListener('pointerdown', (e) => {
  dragging = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging || !stage) return;
  stage.orbit(e.clientX - dragging.x, e.clientY - dragging.y);
  dragging = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointerup', () => (dragging = null));
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  stage?.zoom(e.deltaY > 0 ? 1.1 : 0.9);
}, { passive: false });
document.getElementById('prev').addEventListener('click', () => stage && stage.drive(stage.step));
document.getElementById('next').addEventListener('click', () => stage && stage.drive(stage.step + 2));

reply({ ready: true });
