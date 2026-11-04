// The welcome window: one screen at a time. The three settings screens save
// as the user moves on (engine through the notch's own settings, the rest
// through onboarding.save); every key is optional.
const api = window.judith;
const $ = (id) => document.getElementById(id);
const screens = [...document.querySelectorAll('.screen')];
const NEXT_LABELS = ['Découvrir', 'Configurer', 'Continuer', 'Continuer', 'Continuer', 'Essayer maintenant'];
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
  if (current !== 3) stopMic();
}

const SAVES = { 2: saveEngine, 3: saveListening, 4: saveShortcuts };
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
    { id: 'auto', label: 'Automatique', tagline: `Le premier installé : ${engines.engine === 'api' ? 'une clé API' : (engines.engines.find((e) => e.id === engines.engine)?.label ?? 'aucun')}`, installed: true },
    ...engines.engines.map((e) => ({ ...e, tagline: e.id === 'api' ? 'Anthropic, OpenAI, Gemini, OpenRouter… avec ta clé' : e.installed ? 'Installé sur ce PC' : 'Pas installé sur ce PC' })),
  ];
  box.innerHTML = options
    .map(
      (o) => `<label class="option"><input type="radio" name="engine" value="${o.id}" ${o.id === chosen ? 'checked' : ''} ${o.installed ? '' : 'disabled'}>
      <span><b>${o.label}</b><span class="tagline">${o.tagline}</span></span></label>`,
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
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (error) {
    return setStatus('mic-status', `Micro indisponible : ${error.message}. Vérifie Paramètres Windows → Confidentialité → Microphone.`, 'err');
  }
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(micStream).connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  let loudest = 0;
  setStatus('mic-status', 'Parle un peu : la barre doit bouger.');
  const tick = () => {
    analyser.getFloatTimeDomainData(data);
    const level = Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length);
    loudest = Math.max(loudest, level);
    $('meter').style.width = `${Math.min(100, level * 600)}%`;
    if (loudest > 0.04) setStatus('mic-status', 'Je t\'entends bien.', 'ok');
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
  $('meter').style.width = '0';
}
$('mic-test').addEventListener('click', startMic);
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
  $('ready-shortcut').innerHTML = keys(status.shortcut);
  return true;
}

// ----- start -----
async function load() {
  [status, engines] = await Promise.all([api.onboarding.status(), api.settings.get()]);
  renderEngines();
  $(status.listenMode === 'push' ? 'listen-push' : 'listen-auto').checked = true;
  $(status.speechInput === 'deepgram' ? 'stt-cloud' : 'stt-local').checked = true;
  $('deepgram-note').textContent = status.deepgramSet ? 'déjà enregistrée, laisse vide pour la garder' : 'facultative';
  syncDeepgram();
  $('shortcut').innerHTML = status.shortcuts.map((s) => `<option value="${s}" ${s === status.shortcut ? 'selected' : ''}>${s.replace('Control', 'Ctrl').replace('Shift', 'Maj').replace(/\+/g, ' + ')}</option>`).join('');
  $('zone-shortcut').innerHTML = keys(status.zoneShortcut);
  $('ready-shortcut').innerHTML = keys(status.shortcut);
  $('start-windows').checked = status.startWithWindows;
  $('start-windows').disabled = !status.packaged;
  $('start-note').hidden = status.packaged;
}
show(0);
load().catch((error) => setStatus('engine-status', `Réglages indisponibles : ${error.message}`, 'err'));
