import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentGoal, changedTiles, createAgent, createProgressWatch } from '../src/core/agent.js';

test('the special word starts agent mode, nothing else does', () => {
  assert.equal(agentGoal('Agent, exporte cette vidéo en MP4'), 'exporte cette vidéo en MP4');
  assert.equal(agentGoal('mode agent : crée un dépôt GitHub'), 'crée un dépôt GitHub');
  assert.equal(agentGoal('En mode agent, installe Docker'), 'installe Docker');
  assert.equal(agentGoal('agent'), null);
  assert.equal(agentGoal("c'est quoi un agent ?"), null);
  assert.equal(agentGoal('Agents secrets'), null);
  assert.equal(agentGoal('agentique'), null);
});

test('the loop: start, answers and screen changes, a step limit', () => {
  const agent = createAgent({ maxSteps: 3 });
  assert.equal(agent.question('Où est le bouton ?'), 'Où est le bouton ?');
  assert.equal(agent.next(), null, 'no loop, no next step');
  assert.match(agent.question('Agent, exporte en MP4'), /^\(Agent mode, step 1\/3\) Goal: exporte en MP4\n/);
  assert.equal(agent.active, true);
  assert.match(agent.next(), /step 2\/3.*\nThe screen changed/s);
  assert.match(agent.question('le format 1080p'), /step 3\/3[\s\S]*My answer: le format 1080p/);
  assert.equal(agent.next(), null, 'limit reached');
  assert.equal(agent.active, false);
});

test('a new special word restarts the loop on a new goal', () => {
  const agent = createAgent();
  agent.question('Agent, ouvre les réglages');
  agent.next();
  assert.match(agent.question('Agent, change le thème'), /step 1\/\d+\) Goal: change le thème/);
});

// Small BGRA screenshots for the watch.
const image = (width, height, fill) => {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const v = fill(i % width, Math.floor(i / width));
    data.set([v, v, v, 255], i * 4);
  }
  return { data, width, height };
};
const W = 80;
const H = 60;
const plain = image(W, H, (x, y) => ((x >> 2) + (y >> 2)) % 2 ? 230 : 200);
// A menu opened at the top left.
const menu = image(W, H, (x, y) => (x < 20 && y < 20 ? (y % 4 < 2 ? 20 : 250) : ((x >> 2) + (y >> 2)) % 2 ? 230 : 200));
// A video playing at the bottom right: a different frame each time.
const video = (n) => image(W, H, (x, y) => (x >= 60 && y >= 45 ? ((x + y + n * 7) % 9) * 28 : ((x >> 2) + (y >> 2)) % 2 ? 230 : 200));

test('changed tiles: only where the content changed', () => {
  assert.deepEqual(changedTiles(plain, plain), []);
  const tiles = changedTiles(plain, menu);
  assert.ok(tiles.length > 0 && tiles.every((t) => t % 8 < 2 && t < 16), `top-left tiles only: ${tiles}`);
});

test('progress: waits, sees the change, fires once the screen settled', () => {
  const watch = createProgressWatch();
  const states = [plain, plain, plain, plain, menu, menu, menu].map((frame) => watch.push(frame));
  assert.deepEqual(states, ['waiting', 'waiting', 'waiting', 'waiting', 'changing', 'changing', 'changed']);
});

test('progress: a video playing by itself is learned and ignored', () => {
  const watch = createProgressWatch();
  const frames = [video(0), video(1), video(2), video(3), video(4), video(5)];
  assert.ok(frames.map((f) => watch.push(f)).every((s) => s === 'waiting'));
  assert.ok(watch.noisy > 0);
});

test("progress: Judith's own windows are never a change", () => {
  const watch = createProgressWatch();
  const notch = [{ x1: 0, y1: 0, x2: 0.3, y2: 0.4 }];
  const states = [plain, plain, plain, menu, menu, menu].map((frame) => watch.push(frame, notch));
  assert.ok(states.every((s) => s === 'waiting'));
});

test('autonomous: only when allowed; otherwise she guides (and says so)', async () => {
  const { agentRequest } = await import('../src/core/agent.js');
  assert.deepEqual(agentRequest('Agent autonome, range mes onglets'), { goal: 'range mes onglets', autonomous: true });
  assert.deepEqual(agentRequest('mode autonome : vide le cache'), { goal: 'vide le cache', autonomous: true });
  assert.deepEqual(agentRequest('Agent, range mes onglets'), { goal: 'range mes onglets', autonomous: false });

  let allowed = false;
  const agent = createAgent({ canAct: () => allowed });
  assert.match(agent.question('Agent autonome, range mes onglets'), /^\(Agent mode, step 1/);
  assert.equal(agent.autonomous, false);
  assert.equal(agent.refused, true);
  allowed = true;
  assert.match(agent.question('Agent autonome, range mes onglets'), /^\(Autonomous agent mode, step 1.*\nDo it yourself/s);
  assert.equal(agent.autonomous, true);
  assert.match(agent.next(), /Your actions are done/);
  agent.stop();
  assert.equal(agent.autonomous, false);
});

test('offer: the model proposes, a "oui" starts the guided loop', async () => {
  const { offerAnswer } = await import('../src/core/agent.js');
  for (const yes of ['Oui', 'ouais vas-y', "D'accord", 'ok', 'Vas-y', 'yes please', 'Carrément !']) assert.equal(offerAnswer(yes), 'yes', yes);
  for (const no of ['Non', 'non merci', "C'est bon", 'pas besoin', 'Ça ira']) assert.equal(offerAnswer(no), 'no', no);
  for (const other of ['Où est le bouton Exporter ?', 'oui mais comment je fais pour changer la couleur du titre en rouge dans ce document', '']) assert.equal(offerAnswer(other), null, other);

  const agent = createAgent();
  assert.equal(agent.offer('créer un dépôt GitHub'), true);
  const asked = agent.question('Oui');
  assert.match(asked, /^\(Agent mode, step 1\/\d+\) Goal: créer un dépôt GitHub\nYes, guide me to the end/);
  assert.equal(agent.active, true);
  assert.equal(agent.autonomous, false, 'only the guided mode is ever offered');
  assert.equal(agent.offer('autre chose'), false, 'never during a loop');
});

test('offer: "non" asks nothing; twice, and Judith stops offering', () => {
  const agent = createAgent();
  agent.offer('installer Docker');
  assert.equal(agent.question('non merci'), null);
  assert.equal(agent.declined, true);
  assert.equal(agent.active, false);
  agent.offer('exporter en MP4');
  assert.equal(agent.question('Non'), null);
  assert.equal(agent.offer('autre tâche'), false);
});

test('offer: another question drops the offer and is asked as it is', () => {
  const agent = createAgent();
  agent.offer('installer Docker');
  assert.equal(agent.question("C'est quoi Docker ?"), "C'est quoi Docker ?");
  assert.equal(agent.offered, null);
  assert.equal(agent.question('oui'), 'oui', 'no offer any more: an ordinary "oui"');
  assert.equal(agent.active, false);
});
