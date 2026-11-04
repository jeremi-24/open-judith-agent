// The welcome window: one screen at a time, one idea each. The three settings
// screens save as the user moves on (engine through the notch's own settings,
// the rest through onboarding.save); every key is optional.
const api = window.judith;
const $ = (id) => document.getElementById(id);
const screens = [...document.querySelectorAll('.screen')];
const NEXT_LABELS = ['Découvrir', 'Suivant', 'Suivant', 'Continuer', 'Continuer', 'Continuer', 'Essayer maintenant'];
const ENGINE = 3;
const LISTEN = 4;
const SHORTCUT = 5;
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
  // The microphone listens on its own screen only, without a click.
  if (current === LISTEN) startMic();
  else stopMic();
}

const SAVES = { [ENGINE]: saveEngine, [LISTEN]: saveListening, [SHORTCUT]: saveShortcuts };
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

// ----- engine -----
function renderEngines() {
  const box = $('engines');
  const chosen = engines.configured ?? 'auto';
  const options = [
    { id: 'auto', label: 'Automatique', tag: engines.engine === 'api' ? 'clé API' : (engines.engines.find((e) => e.id === engines.engine)?.label ?? 'aucun'), installed: true },
    ...engines.engines.map((e) => ({ ...e, tag: e.id === 'api' ? 'ta clé' : e.installed ? 'installé' : 'absent' })),
  ];
  box.innerHTML = options
    .map(
      (o) => `<label class="option"><input type="radio" name="engine" value="${o.id}" ${o.id === chosen ? 'checked' : ''} ${o.installed ? '' : 'disabled'}>
      <b>${o.label}</b><span class="tag-pill ${o.installed && o.id !== 'api' && o.id !== 'auto' ? 'ok' : ''}">${o.tag}</span></label>`,
    )
    .join('');
  $('api-provider').innerHTML = engines.providers.map((p) => `<option value="${p.id}" ${p.id === engines.apiProvider ? 'selected' : ''}>${p.label}${p.hasKey ? ' (clé enregistrée)' : ''}</option>`).join('');
  box.addEventListener('change', syncApi);
  syncApi();
}
function syncApi() {
  $('api').hidden = document.querySelector('input[name="engine"]:checked')?.value !== 'api';
}
function engineInput() {
  return {
    engine: document.querySelector('input[name="engine"]:checked')?.value ?? 'auto',
    apiProvider: $('api-provider').value || undefined,
    apiKey: $('api-key').value,
  };
}
$('engine-test').addEventListener('click', async () => {
  setStatus('engine-status', 'Test en cours (texte + image)…');
  $('engine-test').disabled = true;
  const result = await api.settings.test(engineInput()).catch((error) => ({ ok: false, error: error.message }));
  $('engine-test').disabled = false;
  setStatus('engine-status', result.ok ? `Ça marche : réponse en ${(result.ms / 1000).toFixed(1)} s.` : `Ça ne marche pas : ${result.error}`, result.ok ? 'ok' : 'err');
});
async function saveEngine() {
  const result = await api.settings.save(engineInput());
  if (!result.ok) setStatus('engine-status', result.error, 'err');
  else engines = result.settings;
  return result.ok;
}

// ----- microphone and listening -----
let micStream = null;
let micFrame = 0;
async function startMic() {
  stopMic();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    // The user left the screen while Windows was opening the mic.
    if (current !== LISTEN) return stream.getTracks().forEach((t) => t.stop());
    micStream = stream;
  } catch (error) {
    return setStatus('mic-status', 'Micro bloqué : Paramètres Windows → Confidentialité → Microphone.', 'err');
  }
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(micStream).connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  let loudest = 0;
  setStatus('mic-status', '');
  const tick = () => {
    analyser.getFloatTimeDomainData(data);
    const level = Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length);
    loudest = Math.max(loudest, level);
    $('pulse').style.transform = `scale(${(1 + Math.min(1, level * 9) * 0.7).toFixed(3)})`;
    if (loudest > 0.04) setStatus('mic-status', 'Je t’entends bien ✓', 'ok');
    micFrame = requestAnimationFrame(tick);
  };
  tick();
  micStream.stop = () => ctx.close();
}
function stopMic() {
  cancelAnimationFrame(micFrame);
  micStream?.getTracks().forEach((t) => t.stop());
  micStream?.stop?.();
  micStream = null;
  $('pulse').style.transform = '';
}
document.querySelectorAll('input[name="stt"]').forEach((r) => r.addEventListener('change', syncDeepgram));
function syncDeepgram() {
  $('deepgram').hidden = !$('stt-cloud').checked;
}
$('deepgram-link').addEventListener('click', () => api.openLink('https://deepgram.com'));
async function saveListening() {
  const deepgram = $('stt-cloud').checked;
  const key = $('deepgram-key').value.trim();
  // Deepgram without any key would not work: stay local until there is one.
  const result = await api.onboarding.save({
    listenMode: $('listen-push').checked ? 'push' : 'auto',
    speechInput: deepgram && (key || status.deepgramSet) ? 'deepgram' : 'whisper',
    deepgramKey: key,
  });
  status = result.status;
  return true;
}

// ----- shortcuts and start -----
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
  $(status.listenMode === 'push' ? 'listen-push' : 'listen-auto').checked = true;
  $(status.speechInput === 'deepgram' ? 'stt-cloud' : 'stt-local').checked = true;
  if (status.deepgramSet) $('deepgram-key').placeholder = 'Clé déjà enregistrée';
  syncDeepgram();
  $('shortcut').innerHTML = status.shortcuts.map((s) => `<option value="${s}" ${s === status.shortcut ? 'selected' : ''}>${s.replace('Control', 'Ctrl').replace('Shift', 'Maj').replace(/\+/g, ' + ')}</option>`).join('');
  $('zone-keys').innerHTML = keys(status.zoneShortcut);
  $('shortcut-keys').innerHTML = keys(status.shortcut);
  $('ready-keys').innerHTML = keys(status.shortcut);
  $('start-windows').checked = status.startWithWindows;
  $('start-windows').disabled = !status.packaged;
  if (!status.packaged) $('start-windows').closest('label').title = 'Disponible dans la version installée';
}
show(0);
load().catch((error) => setStatus('engine-status', `Réglages indisponibles : ${error.message}`, 'err'));
