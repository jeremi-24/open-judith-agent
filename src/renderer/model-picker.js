// The model list of the settings: the provider's models, asked on demand, with
// what each one can do. The typed id (the existing input) always stays: a model
// that is not in the list, or a list that failed to load, never blocks anyone.
//   ✓ the provider (or a test call) says it is supported
//   ✗ the provider says it is not
//   ? the provider does not say: the Test button settles it
import { localeOf, t } from '../core/i18n.js';
import { groupModels, priceLabel, selectionStatus, shortTokens } from '../engine/models.js';

const MAX_ROWS = 60;
const GROUPS = [
  { id: 'vision', title: t('Lisent les images'), extra: false },
  { id: 'confirm', title: t('À confirmer avec « Tester »'), extra: false },
  { id: 'text', title: t('Texte seul'), extra: true },
  { id: 'other', title: t('Autres (embedding, audio, retirés…)'), extra: true },
];
const MARK = { supported: '✓', unsupported: '✗', unknown: '?' };
const SELECTION = {
  absent: t('Cet identifiant n’est pas dans la liste : il sera utilisé tel quel (modèle saisi à la main).'),
  retired: t('Ce modèle est retiré par le fournisseur : choisis-en un autre.'),
  'not-chat': t('Ce modèle n’est pas fait pour discuter (embedding, audio…) : Judith ne pourra pas s’en servir.'),
};

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const dateLabel = (ms) => new Date(ms).toLocaleString(localeOf(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// mount: where the list goes; input: the (existing) field holding the model id;
// provider(): the chosen provider id; key(): a key typed but not saved yet.
export function createModelPicker({ mount, input, api, provider, key = () => '' }) {
  mount.classList.add('mp');
  const head = el('div', 'mp-head');
  const search = Object.assign(el('input', 'mp-search'), { type: 'search', placeholder: t('Chercher un modèle…'), autocomplete: 'off', spellcheck: false });
  search.setAttribute('aria-label', t('Chercher un modèle'));
  const refresh = Object.assign(el('button', 'mp-refresh', t('Actualiser')), { type: 'button' });
  head.append(search, refresh);
  const status = el('p', 'mp-status');
  status.setAttribute('aria-live', 'polite');
  const list = el('div', 'mp-list');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', t('Modèles'));
  const moreLabel = el('label', 'mp-more');
  const more = Object.assign(document.createElement('input'), { type: 'checkbox' });
  moreLabel.append(more, t(' Afficher aussi les modèles texte seul et les autres'));
  const legend = el('p', 'mp-legend', t('✓ confirmé par le fournisseur ou par un test · contour pointillé : déclaré par le catalogue models.dev · ? inconnu · ✗ non pris en charge'));
  const selection = el('p', 'mp-selection');
  mount.replaceChildren(head, status, list, moreLabel, legend, selection);

  let current = { models: [], ok: true };
  let loading = 0;

  function setStatus(text, kind = '') {
    status.textContent = text;
    status.className = `mp-status ${kind}`;
  }

  // A capability: dashed when the catalog said it (not the provider), see catalog.js.
  function badge(label, state, title, declared = false) {
    const node = el('span', `mp-badge ${state}${declared ? ' catalog' : ''}`, `${label} ${MARK[state]}`);
    node.title = declared ? t('{title} (déclaré par le catalogue models.dev, pas par le fournisseur)', { title }) : title;
    return node;
  }

  function row(model) {
    const item = el('div', 'mp-row');
    item.setAttribute('role', 'option');
    item.tabIndex = 0;
    item.dataset.id = model.id;
    item.setAttribute('aria-selected', String(model.id === input.value.trim()));
    const name = el('div', 'mp-name', model.name);
    if (model.verified) name.append(el('span', 'mp-tested', t('testé')));
    if (model.source === 'builtin') name.append(el('span', 'mp-tested', t('suggestion')));
    const meta = el('div', 'mp-meta');
    meta.append(el('code', '', model.id));
    const caps = model.capabilities;
    const facts = el('div', 'mp-facts');
    const declared = (field) => model.fromCatalog?.includes(field);
    facts.append(badge(t('Vision'), caps.vision, t('Lit les captures d’écran'), declared('vision')));
    if (caps.tools !== 'unknown') facts.append(badge(t('Outils'), caps.tools, t('Appel d’outils'), declared('tools')));
    if (model.openWeights === 'supported') facts.append(badge(t('Poids ouverts'), 'supported', t('Les poids du modèle sont publics (ce n’est ni « gratuit » ni forcément « open source »)'), declared('openWeights')));
    if (caps.streaming !== 'unknown') facts.append(badge(t('Flux'), caps.streaming, t('Réponse mot à mot')));
    const size = shortTokens(model.contextWindow);
    if (size) facts.append(el('span', 'mp-fact', t('{size} de contexte', { size })));
    const price = priceLabel(model.pricing);
    if (price) facts.append(el('span', `mp-fact${price === t('gratuit') ? ' free' : ''}`, price));
    if (model.status === 'retired') facts.append(el('span', 'mp-fact warn', t('retiré')));
    else if (model.status === 'deprecated') facts.append(el('span', 'mp-fact warn', t('bientôt retiré')));
    else if (model.retiresAt) facts.append(el('span', 'mp-fact warn', t('retrait le {retiresAt}', { retiresAt: model.retiresAt })));
    if (model.hint) facts.append(el('span', 'mp-fact warn', { embedding: t('le nom évoque un embedding'), audio: t('le nom évoque l’audio'), image: t('le nom évoque la génération d’images') }[model.hint]));
    item.append(name, meta, facts);
    const choose = () => {
      input.value = model.id;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      render();
    };
    item.addEventListener('click', choose);
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        choose();
      }
    });
    return item;
  }

  function render() {
    const query = search.value.trim().toLowerCase();
    const matching = current.models.filter((m) => !query || m.id.toLowerCase().includes(query) || m.name.toLowerCase().includes(query));
    const groups = groupModels(matching);
    const nodes = [];
    let shown = 0;
    let hidden = 0;
    for (const group of GROUPS) {
      if (group.extra && !more.checked) continue;
      const models = groups[group.id];
      if (!models.length) continue;
      nodes.push(el('h4', 'mp-group', `${group.title} (${models.length})`));
      for (const model of models) {
        if (shown >= MAX_ROWS) hidden += 1;
        else {
          nodes.push(row(model));
          shown += 1;
        }
      }
    }
    if (hidden) nodes.push(el('p', 'mp-cut', t('{hidden} autres : affine la recherche.', { hidden })));
    if (!nodes.length) nodes.push(el('p', 'mp-cut', current.models.length ? t('Aucun modèle ne correspond.') : t('Aucun modèle à afficher.')));
    list.replaceChildren(...nodes);
    const verdict = selectionStatus(current.models, input.value);
    // A failed list says nothing about the typed id.
    selection.textContent = current.ok ? SELECTION[verdict] ?? '' : '';
    selection.className = `mp-selection ${verdict === 'absent' ? '' : 'warn'}`;
  }

  // refreshList: ask the provider again (the button); otherwise the cache is enough.
  // The same request already running (a key pasted, then the Test button…) is not sent twice.
  let inflight = null;
  function load({ refreshList = false } = {}) {
    const signature = `${provider()}|${key()}|${refreshList}`;
    if (inflight?.signature === signature) return inflight.promise;
    const promise = run({ refreshList }).finally(() => {
      if (inflight?.promise === promise) inflight = null;
    });
    inflight = { signature, promise };
    return promise;
  }

  async function run({ refreshList }) {
    const id = provider();
    if (!id) return;
    const mine = ++loading;
    refresh.disabled = true;
    mount.classList.add('loading');
    setStatus(t('Chargement de la liste…'));
    const result = await api.settings.models({ provider: id, refresh: refreshList, apiKey: key() }).catch(() => ({ ok: false, models: [], error: { message: t('La liste est indisponible. Saisis le modèle à la main.') } }));
    if (mine !== loading) return; // another provider was chosen meanwhile
    refresh.disabled = false;
    mount.classList.remove('loading');
    current = { models: result.models ?? [], ok: result.ok };
    if (!result.ok) setStatus(t('{message} Suggestions intégrées, non vérifiées.', { message: result.error?.message ?? t('La liste est indisponible.') }), 'err');
    else if (result.stale) setStatus(t('{message} Liste enregistrée le {date}.', { message: result.error?.message ?? t('Fournisseur injoignable.'), date: dateLabel(result.fetchedAt) }), 'warn');
    else {
      const from = result.source === 'cache' ? t('liste du {date}', { date: dateLabel(result.fetchedAt) }) : t('liste à jour');
      setStatus(t('{count} modèles · {from}{partial}', { count: current.models.length, from, partial: result.partial ? ` ${t('(incomplète)')}` : '' }));
    }
    render();
  }

  refresh.addEventListener('click', () => load({ refreshList: true }));
  search.addEventListener('input', render);
  more.addEventListener('change', render);
  input.addEventListener('input', render);

  return { load, render, get models() { return current.models; } };
}
