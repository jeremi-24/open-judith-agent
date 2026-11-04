// The welcome window: one screen at a time, one idea each. The two settings
// screens save as the user moves on (the AI through the notch's own settings,
// the shortcut through onboarding.save); listening keeps its defaults (they
// are in the notch's settings). Every key is optional.
import { createModelPicker } from './model-picker.js';
const api = window.judith;
const $ = (id) => document.getElementById(id);
const screens = [...document.querySelectorAll('.screen')];
const NEXT_LABELS = ['Découvrir', 'Suivant', 'Suivant', 'Continuer', 'Continuer', 'Essayer maintenant'];
const ENGINE = 3;
const SHORTCUT = 4;
let current = 0;
let status = null;
let engines = null;

// "Control+Alt+J" → Ctrl Alt J keys
const keys = (accelerator) =>
  String(accelerator ?? '')
    .split('+')
    .map((k) => `<kbd>${{ Control: 'Ctrl', Shift: 'Maj', Space: 'Espace' }[k] ?? k}</kbd>`)
    .join('');

// ----- navigation -----
const dots = $('dots');
dots.innerHTML = screens.map((s) => `<li title="${s.dataset.title}"></li>`).join('');
function show(index) {
  current = Math.max(0, Math.min(screens.length - 1, index));
  screens.forEach((s, i) => (s.hidden = i !== current));
  [...dots.children].forEach((d, i) => {
    d.classList.toggle('on', i === current);
    d.classList.toggle('past', i < current);
  });
  $('back').style.visibility = current === 0 ? 'hidden' : 'visible';
  $('next').textContent = NEXT_LABELS[current];
}

const SAVES = { [ENGINE]: saveEngine, [SHORTCUT]: saveShortcuts };
$('next').addEventListener('click', async () => {
  if (current === screens.length - 1) return api.onboarding.done({ tryNow: true });
  const save = SAVES[current];
  if (save) {
    $('next').disabled = true;
    const ok = await save().catch(() => false);
    $('next').disabled = false;
    if (!ok) return;
  }
  show(current + 1);
});
$('back').addEventListener('click', () => show(current - 1));
$('skip').addEventListener('click', () => api.onboarding.done({}));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') api.onboarding.done({});
});

function setStatus(id, text, kind = '') {
  const el = $(id);
  el.textContent = text;
  el.className = `status ${kind}`;
}

// ----- the AI: the labels say which one to pick -----
const installed = (id) => engines.engines.some((e) => e.id === id && e.installed);
function renderEngines() {
  const options = [
    { id: 'claude-code', label: "J'ai Claude Code" },
    { id: 'codex', label: "J'ai Codex" },
    { id: 'api', label: "J'ai une clé API" },
    { id: 'none', label: "Je n'ai rien de tout ça" },
  ];
  // Pre-selected: what is configured, else what is installed, else nothing.
  const configured = engines.configured && engines.configured !== 'auto' ? engines.configured : null;
  const chosen = configured ?? (installed('claude-code') ? 'claude-code' : installed('codex') ? 'codex' : engines.providers.some((p) => p.hasKey) ? 'api' : 'none');
  $('engines').innerHTML = options
    .map((o) => {
      const found = o.id !== 'api' && o.id !== 'none' && installed(o.id);
      return `<label class="option"><input type="radio" name="engine" value="${o.id}" ${o.id === chosen ? 'checked' : ''}>
      <b>${o.label}</b>${found ? '<span class="tag-pill ok">détecté</span>' : ''}</label>`;
    })
    .join('');
  // Without any key yet, the free NVIDIA endpoints are the way in.
  const preselected = engines.providers.some((p) => p.hasKey) ? engines.apiProvider : 'nvidia';
  $('api-provider').innerHTML = engines.providers.map((p) => `<option value="${p.id}" ${p.id === preselected ? 'selected' : ''}>${p.label}${p.free ? ' · gratuit' : ''}${p.hasKey ? ' (clé enregistrée)' : ''}</option>`).join('');
  $('api-provider').addEventListener('change', syncProvider);
  $('engines').addEventListener('change', syncEngine);
  syncEngine();
}
const provider = () => engines.providers.find((p) => p.id === $('api-provider').value);
// The models of the chosen provider, on demand; a provider with no default model
// (OpenRouter) opens the list, since the test needs one.
const modelPicker = createModelPicker({ mount: $('model-picker'), input: $('api-model'), api, provider: () => $('api-provider').value, key: () => $('api-key').value });
let pickerFor = null;
function loadModels() {
  const p = provider();
  if (!p || chosenEngine() !== 'api') return;
  if (pickerFor !== p.id) $('api-model').value = p.id === engines.apiProvider ? engines.apiModel ?? '' : '';
  pickerFor = p.id;
  $('models-more').hidden = false;
  if (!p.model) $('models-more').open = true;
  modelPicker.load();
}
$('models-more').addEventListener('toggle', () => $('models-more').open && modelPicker.load());
$('api-key').addEventListener('change', () => chosenEngine() === 'api' && modelPicker.load());
function syncProvider() {
  const p = provider();
  $('api-key').placeholder = p?.keyPrefix ? `Colle ta clé (${p.keyPrefix}…)` : 'Colle ta clé';
  $('get-provider-key').hidden = !p?.keyUrl;
  setStatus('engine-status', p?.free ? `Gratuit : ${p.freeNote}.` : '');
  loadModels();
}
const chosenEngine = () => document.querySelector('input[name="engine"]:checked')?.value ?? 'none';
function syncEngine() {
  const engine = chosenEngine();
  $('api').hidden = engine !== 'api';
  $('models-more').hidden = engine !== 'api';
  $('none').hidden = engine !== 'none';
  if (engine === 'api') return syncProvider();
  setStatus('engine-status', (engine === 'claude-code' || engine === 'codex') && !installed(engine) ? 'Pas trouvé sur ce PC : installe-le, puis relance Judith.' : '');
}
function engineInput() {
  const engine = chosenEngine();
  const input = { engine: engine === 'none' ? 'auto' : engine, apiProvider: $('api-provider').value || undefined, apiKey: $('api-key').value };
  // The typed model (the list fills it); another provider's model makes no sense, so it starts from its own.
  if (engine === 'api') input.apiModel = input.apiProvider !== engines.apiProvider && pickerFor !== input.apiProvider ? '' : $('api-model').value.trim();
  return input;
}
$('engine-test').addEventListener('click', async () => {
  setStatus('engine-status', 'Test en cours…');
  $('engine-test').disabled = true;
  const result = await api.settings.test(engineInput()).catch((error) => ({ ok: false, error: error.message }));
  $('engine-test').disabled = false;
  // The test may have proved (or ruled out) vision for this model.
  if (chosenEngine() === 'api') modelPicker.load();
  setStatus('engine-status', result.ok ? `Ça marche (${(result.ms / 1000).toFixed(1)} s) ✓` : `Ça ne marche pas : ${result.error}`, result.ok ? 'ok' : 'err');
});
$('get-claude').addEventListener('click', () => api.openLink('https://docs.claude.com/en/docs/claude-code/setup'));
$('get-key').addEventListener('click', () => api.openLink(engines.providers.find((p) => p.id === 'nvidia')?.keyUrl ?? 'https://build.nvidia.com'));
$('get-gemini').addEventListener('click', () => api.openLink('https://aistudio.google.com/apikey'));
$('get-provider-key').addEventListener('click', () => provider()?.keyUrl && api.openLink(provider().keyUrl));
async function saveEngine() {
  const result = await api.settings.save(engineInput());
  if (!result.ok) setStatus('engine-status', result.error, 'err');
  else engines = result.settings ?? engines;
  return result.ok;
}

// ----- shortcut and start -----
async function saveShortcuts() {
  const result = await api.onboarding.save({ shortcut: $('shortcut').value, startWithWindows: $('start-windows').checked });
  status = result.status;
  if (!result.ok) {
    setStatus('shortcut-status', result.error, 'err');
    $('shortcut').value = status.shortcut;
    return false;
  }
  $('ready-keys').innerHTML = keys(status.shortcut);
  return true;
}
$('shortcut').addEventListener('change', () => ($('shortcut-keys').innerHTML = keys($('shortcut').value)));

// ----- start -----
async function load() {
  [status, engines] = await Promise.all([api.onboarding.status(), api.settings.get()]);
  renderEngines();
  $('shortcut').innerHTML = status.shortcuts.map((s) => `<option value="${s}" ${s === status.shortcut ? 'selected' : ''}>${s.replace('Control', 'Ctrl').replace('Shift', 'Maj').replace(/\+/g, ' + ')}</option>`).join('');
  $('shortcut-keys').innerHTML = keys(status.shortcut);
  $('ready-keys').innerHTML = keys(status.shortcut);
  $('start-windows').checked = status.startWithWindows;
  $('start-windows').disabled = !status.packaged;
  if (!status.packaged) $('start-windows').closest('label').title = 'Disponible dans la version installée';
}
show(0);
load().catch((error) => setStatus('engine-status', `Réglages indisponibles : ${error.message}`, 'err'));
