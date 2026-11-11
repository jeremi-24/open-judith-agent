// The welcome window: one screen at a time, one idea each. The Claude Code
// screen only checks that it is there; the shortcut screen saves as the user
// moves on (onboarding.save). The other settings are in the notch.
import { t, translateDocument } from '../core/i18n.js';
translateDocument(document);
const api = window.judith;
const $ = (id) => document.getElementById(id);
const screens = [...document.querySelectorAll('.screen')];
const NEXT_LABELS = [t('Découvrir'), t('Suivant'), t('Suivant'), t('Suivant'), t('Suivant'), t('Suivant'), t('Essayer maintenant')];
let current = 0;
let status = null;
let engines = null;

// "Control+Alt+J" → Ctrl Alt J keys
const keys = (accelerator) =>
  String(accelerator ?? '')
    .split('+')
    .map((k) => `<kbd>${{ Control: 'Ctrl', Shift: t('Maj'), Space: t('Espace') }[k] ?? k}</kbd>`)
    .join('');

// ----- photos: a screen shows assets/onboarding/<name>.jpg when it exists, else its drawn demo -----
for (const screen of screens) {
  const name = screen.dataset.media;
  if (!name) continue;
  const photo = Object.assign(new Image(), { className: 'media', alt: '', src: `../../assets/onboarding/${name}.jpg` });
  photo.addEventListener('load', () => screen.classList.add('has-media'));
  screen.querySelector('h1').after(photo);
}

// ----- navigation -----
const dots = $('dots');
dots.innerHTML = screens.map((s) => `<li title="${t(s.dataset.title)}"></li>`).join('');
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

// Only the last screen saves (the shortcut, start with Windows), then she can be tried.
$('next').addEventListener('click', async () => {
  if (current < screens.length - 1) return show(current + 1);
  $('next').disabled = true;
  const ok = await saveShortcuts().catch(() => false);
  $('next').disabled = false;
  if (ok) api.onboarding.done({ tryNow: true });
});
$('back').addEventListener('click', () => show(current - 1));
$('skip').addEventListener('click', () => api.onboarding.done({}));
// FR | EN: the main process saves it and every window (this one included) redraws in it.
for (const button of document.querySelectorAll('.lang button')) {
  button.setAttribute('aria-pressed', String(button.dataset.lang === api.language));
  button.addEventListener('click', () => button.dataset.lang !== api.language && api.setLanguage(button.dataset.lang));
}
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') api.onboarding.done({});
});

function setStatus(id, text, kind = '') {
  const el = $(id);
  el.textContent = text;
  el.className = `status ${kind}`;
}

// ----- her brain: the user's own Claude Code, found on this PC or to install -----
function renderEngine() {
  const found = Boolean(engines?.claudeFound);
  const row = document.createElement('div');
  row.className = 'option';
  const tag = Object.assign(document.createElement('span'), { className: found ? 'tag-pill ok' : 'tag-pill', textContent: found ? t('détecté') : t('introuvable') });
  row.append(Object.assign(document.createElement('b'), { textContent: 'Claude Code' }), tag);
  $('engines').replaceChildren(row);
  $('found').hidden = !found;
  $('none').hidden = found;
  setStatus('engine-status', found ? '' : t('Pas trouvé sur ce PC : installe Claude Code (pas Claude Desktop), puis clique sur « Vérifier à nouveau ».'));
}
$('engine-test').addEventListener('click', async () => {
  setStatus('engine-status', t('Test en cours…'));
  $('engine-test').disabled = true;
  const result = await api.settings.test({}).catch((error) => ({ ok: false, error: error.message }));
  $('engine-test').disabled = false;
  setStatus('engine-status', result.ok ? t('Ça marche ({value} s) ✓', { value: (result.ms / 1000).toFixed(1) }) : t('Ça ne marche pas : {error}', { error: result.error }), result.ok ? 'ok' : 'err');
});
$('get-claude').addEventListener('click', () => api.openLink('https://docs.claude.com/en/docs/claude-code/setup'));
// Installed meanwhile: look again, without restarting Judith.
$('recheck').addEventListener('click', async () => {
  $('recheck').disabled = true;
  engines = await api.settings.get().catch(() => engines);
  $('recheck').disabled = false;
  renderEngine();
});

// ----- shortcut and start -----
async function saveShortcuts() {
  const result = await api.onboarding.save({ shortcut: $('shortcut').value, startWithWindows: $('start-windows').checked });
  status = result.status;
  if (!result.ok) {
    setStatus('shortcut-status', result.error, 'err');
    $('shortcut').value = status.shortcut;
    return false;
  }
  $('hero-keys').innerHTML = keys(status.shortcut);
  return true;
}
$('shortcut').addEventListener('change', () => {
  $('shortcut-keys').innerHTML = keys($('shortcut').value);
  $('hero-keys').innerHTML = keys($('shortcut').value);
});

// ----- start -----
async function load() {
  [status, engines] = await Promise.all([api.onboarding.status(), api.settings.get()]);
  renderEngine();
  $('shortcut').innerHTML = status.shortcuts.map((s) => `<option value="${s}" ${s === status.shortcut ? 'selected' : ''}>${s.replace('Control', 'Ctrl').replace('Shift', t('Maj')).replace(/\+/g, ' + ')}</option>`).join('');
  $('shortcut-keys').innerHTML = keys(status.shortcut);
  $('hero-keys').innerHTML = keys(status.shortcut);
  $('start-windows').checked = status.startWithWindows;
  $('start-windows').disabled = !status.packaged;
  if (!status.packaged) $('start-windows').closest('label').title = t('Disponible dans la version installée');
}
show(0);
load().catch((error) => setStatus('engine-status', t('Réglages indisponibles : {error}', { error: error.message }), 'err'));
