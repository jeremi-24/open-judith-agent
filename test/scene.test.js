// The 3D scene frame's bricks and stage, run in Node with the real three.js
// (the same classic scripts the frame loads, through vm; no WebGL needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const file = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
function frame() {
  const context = createContext({ console });
  for (const script of ['../node_modules/three/build/three.min.js', '../src/renderer/scene-bricks.js', '../src/renderer/scene-runtime.js']) {
    runInContext(file(script), context);
  }
  return context;
}
const { THREE, JudithBricks, JudithStage } = frame();
const fresh = () => {
  const rendered = [];
  const stage = JudithStage.createStage(THREE, { renderer: { render: () => rendered.push(1), setSize() {} } });
  return { stage, rendered, J: JudithBricks.makeJ(THREE) };
};

test('layout: parts end to end, centred on 0', () => {
  assert.deepEqual([...JudithBricks.layout([2, 2], 0)], [-1, 1]);
  assert.deepEqual([...JudithBricks.layout([1, 2, 1], 0.5)], [-2, 0, 2]);
  assert.deepEqual([...JudithBricks.layout([4], 1)], [0]);
});

test('assembly: one named, labelled mesh per part, along the axis', () => {
  const { stage, J } = fresh();
  const engine = J.assembly(stage, [
    { name: "Entrée d'air", shape: 'cone', radius: 1, radiusEnd: 1.2, length: 1 },
    { name: 'Compresseur', shape: 'cylinder', radius: 1, length: 2 },
    { name: 'Chambre', shape: 'ring', radius: 0.8 },
    { name: 'Tuyère', shape: 'box', length: 1, color: 'blush' },
  ]);
  assert.equal(engine.parts.length, 4);
  assert.deepEqual([...stage.labels.map((l) => l.text)], ["Entrée d'air", 'Compresseur', 'Chambre', 'Tuyère']);
  const xs = engine.parts.map((m) => m.position.x);
  assert.ok(xs.every((x, i) => i === 0 || x > xs[i - 1]), 'in order along x');
  assert.ok(Math.abs(xs[0] + xs[3]) < 1e-9, 'centred');
  assert.equal(engine.parts[3].material.color.getHex(), JudithBricks.PALETTE.blush);
  // Cylinders are laid along x.
  assert.equal(engine.parts[1].rotation.z, -Math.PI / 2);
});

test('runScene: runs the code, fits the camera, steps follow the voice', () => {
  const { stage, rendered, J } = fresh();
  const code = `
    const a = J.assembly(stage, [{ name: 'A', shape: 'cylinder', length: 2 }, { name: 'B', shape: 'sphere', radius: 1 }]);
    J.flow(stage, [-3, 0, 0], [3, 0, 0], { count: 5 });
    stage.steps(a.parts.map((p) => ({ target: p })));`;
  const result = JudithStage.runScene(THREE, J, stage, code);
  assert.equal(result.ok, true);
  assert.equal(stage.stepCount, 2);
  assert.equal(stage.step, 0);
  stage.tick(0.1, 0.1);
  assert.equal(rendered.length, 1);
  assert.ok(stage.labels.find((l) => l.text === 'A').active);
  assert.equal(stage.drive(2), 1);
  assert.ok(stage.labels.find((l) => l.text === 'B').active);
  // Driven by the voice: no automatic advance any more.
  stage.tick(1, JudithStage.STEP_EVERY + 1);
  assert.equal(stage.step, 1);
});

test('steps advance by themselves when no voice drives them', () => {
  const { stage, J } = fresh();
  JudithStage.runScene(THREE, J, stage, `const a = J.assembly(stage, [{ name: 'A' }, { name: 'B' }, { name: 'C' }]); stage.steps(a.parts.map((p) => ({ target: p })));`);
  stage.tick(0, JudithStage.STEP_EVERY);
  assert.equal(stage.step, 1);
});

test('runScene: errors and empty scenes are reported, not thrown', () => {
  const broken = JudithStage.runScene(THREE, fresh().J, fresh().stage, 'J.nope(stage)');
  assert.equal(broken.ok, false);
  assert.match(broken.error, /TypeError/);
  const syntax = JudithStage.runScene(THREE, fresh().J, fresh().stage, 'const = ;');
  assert.match(syntax.error, /SyntaxError/);
  const empty = JudithStage.runScene(THREE, fresh().J, fresh().stage, '// nothing');
  assert.match(empty.error, /empty/);
});

test('a broken animation is dropped, the scene keeps rendering', () => {
  const { stage, rendered, J } = fresh();
  const seen = [];
  stage.onError = (e) => seen.push(e.message);
  JudithStage.runScene(THREE, J, stage, `J.assembly(stage, [{ name: 'A' }]); stage.onFrame(() => { throw new Error('boom'); });`);
  stage.tick(0, 0.016);
  stage.tick(0.016, 0.016);
  assert.deepEqual(seen, ['boom']);
  assert.equal(rendered.length, 2);
});

test('labels project onto the view, the explode brick moves parts out', () => {
  const { stage, J } = fresh();
  const a = J.assembly(stage, [{ name: 'A', length: 1 }, { name: 'B', length: 1 }]);
  J.explode(stage, a, 1);
  stage.fit();
  for (let i = 0; i < 60; i++) stage.tick(i / 30, 1 / 30);
  assert.ok(a.parts[1].position.x > a.parts[1].userData.home.x, 'B moved out');
  const label = stage.labels[0];
  assert.ok(label.visible && label.x > 0 && label.x < 320 && label.y > 0 && label.y < 300, 'label on the view');
});
