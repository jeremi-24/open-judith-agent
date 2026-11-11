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
// Arrays made inside the frame's context are not the test's own: compare them as data.
const plain = (value) => JSON.parse(JSON.stringify(value));
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

// ----- J.build: any solids, placed freely, appearing step by step -----
const PARTS = [
  { name: 'Base', shape: 'box', at: [0, 0, 0], size: [4, 0.4, 3] },
  { name: 'Wall', shape: 'box', at: [-1, 1, 0], size: [0.4, 1.6, 3], step: 2 },
  { name: 'Wall 2', shape: 'box', at: [1, 1, 0], size: [0.4, 1.6, 3] },
  { name: 'Roof', shape: 'prism', at: [0, 2.3, 0], size: [3, 1, 3.2], step: 3, color: 'blush' },
  { name: 'Vault', shape: 'halfcylinder', at: [0, 0.6, 2], radius: 1, length: 1.5, step: 3 },
  { name: 'Plan', shape: 'extrude', outline: [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]], depth: 0.5, at: [3, 0, 0], step: 4 },
  { name: 'Ball', shape: 'sphere', radius: 0.4, at: [3, 1, 0], step: 4 },
];

test('build: every shape makes a mesh at its place, centred on `at`, with a label', () => {
  const { stage, J } = fresh();
  const built = J.build(stage, PARTS, { steps: false });
  assert.equal(built.parts.length, PARTS.length);
  const world = (mesh) => mesh.getWorldPosition(new THREE.Vector3());
  PARTS.forEach((part, i) => {
    const p = world(built.parts[i]);
    assert.ok(Math.abs(p.x - part.at[0]) < 1e-9 && Math.abs(p.y - part.at[1]) < 1e-9 && Math.abs(p.z - part.at[2]) < 1e-9, `${part.name} at ${part.at}`);
  });
  // Extruded shapes are centred on their middle, whatever their outline.
  const middle = new THREE.Box3().setFromObject(built.parts[5]).getCenter(new THREE.Vector3());
  assert.ok(Math.abs(middle.x - 3) < 0.01 && Math.abs(middle.y) < 0.01, 'the outline is centred on at');
  assert.deepEqual([...stage.labels.map((l) => l.text)], PARTS.map((p) => p.name));
  assert.equal(built.parts[3].material.color.getHex(), JudithBricks.PALETTE.blush);
  assert.ok(built.parts[0].children.some((c) => c.isLineSegments), 'thin edges by default');
});

test('build: smooth shapes have the size that was asked for, and boxes have soft edges by default', () => {
  const { stage, J } = fresh();
  const size = (part) => {
    const mesh = J.build(fresh().stage, [part], { steps: false }).parts[0];
    return new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
  };
  const near = (v, [x, y, z], tolerance = 0.02) => Math.abs(v.x - x) < tolerance && Math.abs(v.y - y) < tolerance && Math.abs(v.z - z) < tolerance;
  assert.ok(near(size({ shape: 'box', size: [4, 1, 2] }), [4, 1, 2]), 'a soft box is as big as a sharp one');
  assert.ok(near(size({ shape: 'box', size: [4, 1, 2], round: false }), [4, 1, 2]));
  assert.ok(near(size({ shape: 'roundbox', size: [3, 1, 2], radius: 0.4 }), [3, 1, 2]));
  assert.ok(near(size({ shape: 'ellipsoid', size: [4, 2, 1] }), [4, 2, 1], 0.1));
  assert.ok(near(size({ shape: 'ellipsoid', radius: 1 }), [2, 2, 2], 0.1), 'a radius alone makes a ball');
  assert.ok(near(size({ shape: 'capsule', radius: 0.5, length: 2 }), [1, 3, 1], 0.1), 'the round ends add to the length');
  // A bottle: radius 1 at the belly, narrow neck, 4 high; turned round y, so as wide as 2 × the widest radius.
  const bottle = size({ shape: 'lathe', outline: [[0, 0], [1, 0.3], [1, 2], [0.3, 3], [0.3, 4]] });
  assert.ok(bottle.y > 3.9 && bottle.y < 4.1 && bottle.x > 1.9 && bottle.x < 2.4, `lathe ${bottle.x} x ${bottle.y}`);
  // A pipe along a path: its length is the path's, its width the pipe's.
  const pipe = size({ shape: 'tube', points: [[0, 0, 0], [3, 0, 0], [3, 2, 0]], radius: 0.1 });
  assert.ok(pipe.x > 3 && pipe.x < 3.5 && pipe.y > 2 && pipe.y < 2.5, `tube ${pipe.x} x ${pipe.y}`);
  // A smooth outline is round where a straight one has corners.
  const smooth = J.build(fresh().stage, [{ shape: 'extrude', outline: [[0, 0], [2, 0], [2, 1], [0, 1]], smooth: true, depth: 1 }], { steps: false }).parts[0];
  const straight = J.build(fresh().stage, [{ shape: 'extrude', outline: [[0, 0], [2, 0], [2, 1], [0, 1]], depth: 1 }], { steps: false }).parts[0];
  assert.ok(smooth.geometry.attributes.position.count > straight.geometry.attributes.position.count * 3, 'many more points on the curve');
});

test('build: parts rotate in degrees, bad input says what is wrong', () => {
  const { stage, J } = fresh();
  const [a] = J.build(stage, [{ shape: 'cylinder', radius: 1, height: 2, rotate: [90, 0, 0] }], { steps: false }).parts;
  assert.ok(Math.abs(a.rotation.x - Math.PI / 2) < 1e-9);
  assert.throws(() => J.build(stage, []), /needs a list of parts/);
  assert.throws(() => J.build(stage, [{ shape: 'extrude', outline: [[0, 0]] }]), /outline/);
  assert.throws(() => J.build(stage, [{ shape: 'lathe', outline: [[1, 0]] }]), /lathe.*outline/);
  assert.throws(() => J.build(stage, [{ shape: 'tube', points: [[0, 0, 0]] }]), /tube.*points/);
  // An unknown shape is a box, not a crash.
  assert.equal(J.build(fresh().stage, [{ shape: 'teapot' }], { steps: false }).parts.length, 1);
});

test('build: steps are the parts, or the groups the model numbers (a part without a number joins the one before)', () => {
  assert.deepEqual(plain(JudithBricks.groupSteps([{}, {}, {}]).map((g) => g.indices)), [[0], [1], [2]]);
  assert.deepEqual(plain(JudithBricks.groupSteps(PARTS).map((g) => [g.key, g.indices])), [[1, [0]], [2, [1, 2]], [3, [3, 4]], [4, [5, 6]]]);
  assert.deepEqual(plain(JudithBricks.groupSteps([{ step: 2 }, { step: 1 }, {}]).map((g) => [g.key, g.indices])), [[1, [1, 2]], [2, [0]]]);
  const { stage, J } = fresh();
  const built = J.build(stage, PARTS);
  assert.equal(stage.stepCount, 4);
  assert.deepEqual(plain(built.steps.map((s) => s.text)), ['Base', 'Wall, Wall 2', 'Roof, Vault', 'Plan, Ball']);
});

test('build: the model grows as the voice reaches each step, and the camera frames the whole of it', () => {
  const { stage, J } = fresh();
  const built = J.build(stage, PARTS);
  const groups = built.groups;
  const visible = () => plain(groups.map((g) => g.visible));
  assert.deepEqual(visible(), [true, false, false, false], 'only the first step at the start');
  stage.fit();
  // The hidden parts count for the framing: the camera is as far as the whole model needs.
  const radius = new THREE.Box3().setFromObject(built.group).getSize(new THREE.Vector3()).length() / 2;
  assert.ok(stage.view.wanted > radius / Math.tan(Math.PI / 9), `camera at ${stage.view.wanted} for a model of radius ${radius}`);
  assert.equal(stage.drive(3), 2);
  assert.deepEqual(visible(), [true, true, true, false]);
  assert.ok(groups[2].scale.x < 0.2, 'it starts small…');
  for (let i = 0; i < 30; i++) stage.tick(i / 30, 1 / 30);
  assert.ok(Math.abs(groups[2].scale.x - 1) < 1e-9, '…and ends at full size');
  // Going back takes the later parts away, and they come back at their own size.
  stage.drive(1);
  assert.deepEqual(visible(), [true, false, false, false]);
  assert.equal(groups[1].scale.x, 1);
});

test('build: labels show only for the parts that are there, and the active ones are the current step', () => {
  const { stage, J } = fresh();
  J.build(stage, PARTS);
  stage.fit();
  stage.tick(0, 0.016);
  const shown = () => plain(stage.labels.filter((l) => l.visible).map((l) => l.text));
  assert.deepEqual(shown(), ['Base']);
  stage.drive(2);
  stage.tick(1, 0.016);
  assert.deepEqual(shown(), ['Base', 'Wall', 'Wall 2']);
  assert.deepEqual(plain(stage.labels.filter((l) => l.active).map((l) => l.text)), ['Wall', 'Wall 2']);
});

test('build: a built-up model stays whole at the end, and finishes by itself if the voice stops early', () => {
  const { stage, J } = fresh();
  J.build(stage, PARTS);
  // Nobody drives: one step every few seconds, then it stops on the whole model.
  for (let i = 0; i < 6; i++) stage.tick(i, JudithStage.STEP_EVERY);
  assert.equal(stage.step, 3);
  const second = fresh();
  const built = second.J.build(second.stage, PARTS);
  second.stage.drive(1);
  second.stage.tick(0, JudithStage.FINISH_AFTER);
  assert.equal(second.stage.step, 1, 'the voice stopped: the next step comes by itself');
  assert.ok(built.groups[1].visible);
});

test('spin, swing and move animate a part', () => {
  const { stage, J } = fresh();
  const [a] = J.build(stage, [{ shape: 'box' }], { steps: false }).parts;
  J.spin(stage, a, { axis: 'y', speed: 1 });
  stage.tick(0, 0.25);
  assert.ok(Math.abs(a.rotation.y - Math.PI / 2) < 1e-9, 'a quarter turn in a quarter second');
  J.swing(stage, a, { axis: 'z', amplitude: 30, speed: 1 });
  stage.tick(0.25, 0.01);
  assert.ok(Math.abs(a.rotation.z - Math.PI / 6) < 1e-9);
  J.move(stage, a, { axis: 'x', amount: 2, speed: 1 });
  stage.tick(0.25, 0.01);
  assert.ok(Math.abs(a.position.x - 2) < 1e-9);
});

test('build: a scene made of too many shapes is refused with a way to simplify it', () => {
  const { stage, J } = fresh();
  const many = Array.from({ length: 13 }, (_, i) => ({ name: `P${i}`, shape: 'box', at: [i, 0, 0] }));
  assert.throws(() => J.build(stage, many), /13 parts: too many.*at most 8/);
  assert.equal(J.build(fresh().stage, many.slice(0, 12), { steps: false }).parts.length, 12, 'the limit itself is allowed');
});

test('at most six labels are written at once, the current ones first, then the latest', () => {
  const { stage, J } = fresh();
  const named = Array.from({ length: 9 }, (_, i) => ({ name: `P${i}`, shape: 'box', at: [i - 4, 0, 0], step: i < 3 ? 1 : i }));
  J.build(stage, named, { steps: false });
  stage.fit();
  stage.tick(0, 0.016);
  assert.equal(stage.labels.filter((l) => l.drawn).length, 6);
  assert.deepEqual(plain(stage.labels.filter((l) => l.drawn).map((l) => l.text)), ['P3', 'P4', 'P5', 'P6', 'P7', 'P8'], 'the latest ones');
  // The current step's labels are kept even when they are the oldest.
  stage.labels[0].active = true;
  stage.tick(0.1, 0.016);
  assert.ok(stage.labels[0].drawn, 'the active label stays');
});

// ----- the labels: in the margins, never on top of each other -----
test('layoutLabels: left and right margins, spaced apart, leader lines start next to the text', () => {
  const items = [
    { x: 130, y: 100, w: 70 }, { x: 135, y: 104, w: 50 },
    { x: 210, y: 150, w: 80 }, { x: 205, y: 152, w: 40 },
  ];
  JudithStage.layoutLabels(items, 340, 300);
  const left = items.filter((i) => i.side === 'left').sort((a, b) => a.ly - b.ly);
  const right = items.filter((i) => i.side === 'right').sort((a, b) => a.ly - b.ly);
  assert.equal(left.length, 2);
  assert.equal(right.length, 2);
  for (const column of [left, right]) for (let i = 1; i < column.length; i++) assert.ok(column[i].ly - column[i - 1].ly >= 22 - 1e-9, 'no overlap');
  assert.equal(left[0].lx, 10);
  assert.equal(right[0].lx, 340 - 10 - right[0].w);
  assert.ok(left[0].ex > left[0].lx + left[0].w, 'the line starts after the text');
  assert.ok(right[0].ex < right[0].lx, 'and before it, on the right');
});

test('layoutLabels: a part right under its label is reached from below, not through the words', () => {
  const under = { x: 300, y: 150, w: 60, side: 'right' };
  JudithStage.layoutLabels([under], 340, 300);
  assert.ok(under.ex >= under.lx && under.ex <= under.lx + under.w, 'the line leaves from the text');
  assert.ok(under.ey > under.ly, 'from its lower edge');
});

test('layoutLabels: new labels share the two margins instead of piling up on one', () => {
  const items = [{ x: 170, y: 60, w: 50 }, { x: 175, y: 120, w: 50 }, { x: 180, y: 180, w: 50 }, { x: 172, y: 240, w: 50 }];
  JudithStage.layoutLabels(items, 340, 300);
  assert.equal(items.filter((i) => i.side === 'left').length, 2);
  assert.equal(items.filter((i) => i.side === 'right').length, 2);
});

test('layoutLabels: stays inside the view, and a label does not jump side near the middle', () => {
  const items = Array.from({ length: 6 }, (_, i) => ({ x: 40, y: 90 + i * 3, w: 60 }));
  JudithStage.layoutLabels(items, 340, 300, { bottom: 100 });
  assert.ok(items.every((i) => i.ly >= 16 && i.ly <= 100), 'inside the margins');
  assert.ok(items.some((i) => i.side === 'right'), 'too many for one margin: the rest go to the other side');
  const one = { x: 150, y: 100, w: 50, side: 'left' };
  JudithStage.layoutLabels([one], 340, 300);
  assert.equal(one.side, 'left', 'just left of the middle: it stays');
  one.x = 210;
  JudithStage.layoutLabels([one], 340, 300);
  assert.equal(one.side, 'right', 'well past the middle: it changes');
});
