// What went wrong with an API call, said in French, with what to do next.
// The raw answer of a provider ("Error code: 404 - {'detail': ...}") means
// nothing to most people; each case gets one sentence of cause and one of remedy.

// The useful sentence inside an error body: JSON of every usual shape, or text.
import { t } from '../core/i18n.js';
export function serverMessage(body) {
  const raw = String(body ?? '').trim();
  if (!raw) return '';
  let message = raw;
  try {
    const data = JSON.parse(raw);
    const found = data?.error?.message ?? (typeof data?.error === 'string' ? data.error : null) ?? data?.message ?? data?.detail ?? data?.title;
    message = typeof found === 'string' ? found : Array.isArray(found) ? found.map((f) => f?.msg ?? f).join(' ') : raw;
  } catch {
    // not JSON: keep the text, unless it is a web page (a proxy's error page)
    if (/^\s*<(!doctype|html)/i.test(raw)) return '';
  }
  return String(message).replace(/\s+/g, ' ').trim().slice(0, 200);
}

const IMAGE = /image|vision|multimodal|multi-modal|modalit/i;
const TOO_LONG = /context|too long|too many tokens|maximum.*length|max.*tokens/i;
const QUOTA = /quota|credit|billing|insufficient|exceeded your current|free tier|limit.*(month|day)/i;

const first = (spec) => spec.models?.[0]?.id;

// An HTTP error → an Error with a French message, `status` and `kind`
// (auth | quota | rate | model | image | size | server | timeout | request).
// spec: the provider (label, keyPrefix, models); retryAfter: seconds or null.
export function explainHttpError({ spec, status, body, model, custom = false, retryAfter = null }) {
  const label = spec.label;
  const detail = serverMessage(body);
  const withDetail = (text) => (detail ? `${text} (${detail})` : text);
  const make = (kind, message) => Object.assign(new Error(message), { status, kind, retryAfter });

  switch (status) {
    case 400:
    case 422:
      if (IMAGE.test(detail)) {
        const example = first(spec);
        return make('image', `${t('« {model} » ne sait pas lire les images, et Judith lui envoie ton écran. Choisis un modèle « vision » dans les réglages', { model })}${example ? ` ${t('(par exemple {example})', { example })}` : ''}.`);
      }
      if (TOO_LONG.test(detail)) return make('size', t('La conversation est trop longue pour ce modèle chez {label} : relance une nouvelle conversation.', { label }));
      return make('request', withDetail(t('{label} a refusé la demande', { label })) + '.');
    case 401:
      return make('auth', t("{label} refuse ta clé API. Vérifie qu'elle est complète{prefix}, sans espace, et qu'elle n'est pas expirée.", { label, prefix: spec.keyPrefix ? ` ${t('(elle commence par « {prefix} »)', { prefix: spec.keyPrefix })}` : '' }));
    case 402:
      return make('quota', t('{label} demande des crédits ou un moyen de paiement. Ajoute-en, ou choisis un fournisseur gratuit.', { label }));
    case 403:
      if (spec.id === 'nvidia') return make('auth', t("NVIDIA ne t'a pas encore donné accès à « {model} ». Ouvre la page de ce modèle sur build.nvidia.com, clique « Try API » une fois, ou choisis un autre modèle.", { model }));
      return make('auth', withDetail(t("{label} refuse l'accès : ta clé n'a pas le droit d'utiliser ce modèle, ou ton pays n'est pas pris en charge", { label })) + '.');
    case 404:
      return make('model', custom ? t("Le serveur ne connaît pas « {model} » (ou son adresse est fausse). Vérifie le nom du modèle et l'adresse dans les réglages.", { model }) : t("Le modèle « {model} » n'existe pas chez {label} (ou plus). Choisis-en un autre dans les réglages.", { model, label }));
    case 408:
    case 504:
      return make('timeout', t('{label} a mis trop de temps à répondre. Réessaie, ou choisis un modèle plus petit.', { label }));
    case 413:
      return make('size', t("La capture d'écran est trop lourde pour {label}. Réessaie avec une zone plus petite.", { label }));
    case 429:
      if (QUOTA.test(detail)) return make('quota', t('Ton quota gratuit chez {label} est épuisé. Attends son renouvellement ou change de fournisseur.', { label }));
      // The provider's own sentence matters: "rate limit" (wait) and "capacity exceeded for this model" (another model) are not the same.
      return make('rate', t("{label} répond « trop de demandes » (429){detail}. Si c'est passager, attends {wait} puis réessaie ; sinon choisis un autre modèle.", { label, detail: detail ? ` : ${detail}` : '', wait: retryAfter ? t('{n} s', { n: retryAfter }) : t('un instant') }));
    case 529:
      return make('server', t('{label} est surchargé en ce moment. Réessaie dans un instant.', { label }));
    default:
      if (status >= 500) return make('server', t('{label} a un problème de son côté (erreur {status}). Réessaie dans un moment.', { label, status }));
      return make('request', withDetail(t('{label} a répondu {status}', { label, status })) + '.');
  }
}

// fetch() itself failed: no network, wrong address, a server that is not running.
export function explainNetworkError({ spec, error, base, custom = false }) {
  const code = error?.cause?.code ?? error?.code ?? '';
  const where = custom ? t('le serveur {base}', { base }) : spec.label;
  let message;
  if (/ENOTFOUND|EAI_AGAIN/.test(code)) message = t('Je ne trouve pas {where}. Vérifie ta connexion internet{more}.', { where, more: custom ? t(" et l'adresse dans les réglages") : '' });
  else if (/ECONNREFUSED/.test(code)) message = custom ? t('Le serveur {base} refuse la connexion : est-il lancé ?', { base }) : t('{label} refuse la connexion. Réessaie dans un instant.', { label: spec.label });
  else if (/ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT/.test(code)) message = t('{spec} ne répond pas à temps. Vérifie ta connexion, puis réessaie.', { spec: spec.label });
  else if (/ECONNRESET|UND_ERR_SOCKET|EPIPE/.test(code)) message = t("La connexion avec {spec} s'est coupée. Réessaie.", { spec: spec.label });
  else if (/CERT|SSL|TLS|SIGNATURE/.test(code)) message = t('La connexion sécurisée avec {spec} échoue (certificat). Un antivirus ou un pare-feu bloque peut-être Judith.', { spec: spec.label });
  else message = t("Je n'arrive pas à joindre {spec}. Vérifie ta connexion internet.", { spec: spec.label });
  return Object.assign(new Error(message), { kind: 'network' });
}

// An error event in the middle of the stream ("overloaded", a quota…).
export function explainStreamError({ spec, message }) {
  const text = String(message ?? '');
  const make = (kind, out) => Object.assign(new Error(out), { kind });
  if (/overload|capacity|busy/i.test(text)) return make('server', t('{spec} est surchargé en ce moment. Réessaie dans un instant.', { spec: spec.label }));
  if (QUOTA.test(text)) return make('quota', t('Ton quota gratuit chez {spec} est épuisé. Attends son renouvellement ou change de fournisseur.', { spec: spec.label }));
  if (/rate/i.test(text)) return make('rate', t('{spec} reçoit trop de demandes : attends un instant puis réessaie.', { spec: spec.label }));
  return make('server', t('{spec} a coupé sa réponse{text}.', { spec: spec.label, text: text ? ` : ${text.slice(0, 160)}` : '' }));
}

// A key pasted from a web page: without spaces, quotes or a "Bearer " prefix.
export function cleanKey(key) {
  return String(key ?? '')
    .replace(/^\s*(?:authorization:\s*)?bearer\s+/i, '')
    .replace(/\s+/g, '')
    .replace(/^["'`]+|["'`]+$/g, '');
}
