// What went wrong with an API call, said in French, with what to do next.
// The raw answer of a provider ("Error code: 404 - {'detail': ...}") means
// nothing to most people; each case gets one sentence of cause and one of remedy.

// The useful sentence inside an error body: JSON of every usual shape, or text.
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
  const make = (kind, message) => Object.assign(new Error(message), { status, kind });

  switch (status) {
    case 400:
    case 422:
      if (IMAGE.test(detail)) {
        const example = first(spec);
        return make('image', `« ${model} » ne sait pas lire les images, et Judith lui envoie ton écran. Choisis un modèle « vision » dans les réglages${example ? ` (par exemple ${example})` : ''}.`);
      }
      if (TOO_LONG.test(detail)) return make('size', `La conversation est trop longue pour ce modèle chez ${label} : relance une nouvelle conversation.`);
      return make('request', withDetail(`${label} a refusé la demande`) + '.');
    case 401:
      return make('auth', `${label} refuse ta clé API. Vérifie qu'elle est complète${spec.keyPrefix ? ` (elle commence par « ${spec.keyPrefix} »)` : ''}, sans espace, et qu'elle n'est pas expirée.`);
    case 402:
      return make('quota', `${label} demande des crédits ou un moyen de paiement. Ajoute-en, ou choisis un fournisseur gratuit.`);
    case 403:
      if (spec.id === 'nvidia') return make('auth', `NVIDIA ne t'a pas encore donné accès à « ${model} ». Ouvre la page de ce modèle sur build.nvidia.com, clique « Try API » une fois, ou choisis un autre modèle.`);
      return make('auth', withDetail(`${label} refuse l'accès : ta clé n'a pas le droit d'utiliser ce modèle, ou ton pays n'est pas pris en charge`) + '.');
    case 404:
      return make('model', custom ? `Le serveur ne connaît pas « ${model} » (ou son adresse est fausse). Vérifie le nom du modèle et l'adresse dans les réglages.` : `Le modèle « ${model} » n'existe pas chez ${label} (ou plus). Choisis-en un autre dans les réglages.`);
    case 408:
    case 504:
      return make('timeout', `${label} a mis trop de temps à répondre. Réessaie, ou choisis un modèle plus petit.`);
    case 413:
      return make('size', `La capture d'écran est trop lourde pour ${label}. Réessaie avec une zone plus petite.`);
    case 429:
      if (QUOTA.test(detail)) return make('quota', `Ton quota gratuit chez ${label} est épuisé. Attends son renouvellement ou change de fournisseur.`);
      return make('rate', `${label} reçoit trop de demandes de ta part : attends ${retryAfter ? `${retryAfter} s` : 'un instant'} puis réessaie.`);
    case 529:
      return make('server', `${label} est surchargé en ce moment. Réessaie dans un instant.`);
    default:
      if (status >= 500) return make('server', `${label} a un problème de son côté (erreur ${status}). Réessaie dans un moment.`);
      return make('request', withDetail(`${label} a répondu ${status}`) + '.');
  }
}

// fetch() itself failed: no network, wrong address, a server that is not running.
export function explainNetworkError({ spec, error, base, custom = false }) {
  const code = error?.cause?.code ?? error?.code ?? '';
  const where = custom ? `le serveur ${base}` : spec.label;
  let message;
  if (/ENOTFOUND|EAI_AGAIN/.test(code)) message = `Je ne trouve pas ${where}. Vérifie ta connexion internet${custom ? ' et l\'adresse dans les réglages' : ''}.`;
  else if (/ECONNREFUSED/.test(code)) message = `${custom ? `Le serveur ${base} refuse la connexion : est-il lancé ?` : `${spec.label} refuse la connexion. Réessaie dans un instant.`}`;
  else if (/ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT/.test(code)) message = `${spec.label} ne répond pas à temps. Vérifie ta connexion, puis réessaie.`;
  else if (/ECONNRESET|UND_ERR_SOCKET|EPIPE/.test(code)) message = `La connexion avec ${spec.label} s'est coupée. Réessaie.`;
  else if (/CERT|SSL|TLS|SIGNATURE/.test(code)) message = `La connexion sécurisée avec ${spec.label} échoue (certificat). Un antivirus ou un pare-feu bloque peut-être Judith.`;
  else message = `Je n'arrive pas à joindre ${spec.label}. Vérifie ta connexion internet.`;
  return Object.assign(new Error(message), { kind: 'network' });
}

// An error event in the middle of the stream ("overloaded", a quota…).
export function explainStreamError({ spec, message }) {
  const text = String(message ?? '');
  const make = (kind, out) => Object.assign(new Error(out), { kind });
  if (/overload|capacity|busy/i.test(text)) return make('server', `${spec.label} est surchargé en ce moment. Réessaie dans un instant.`);
  if (QUOTA.test(text)) return make('quota', `Ton quota gratuit chez ${spec.label} est épuisé. Attends son renouvellement ou change de fournisseur.`);
  if (/rate/i.test(text)) return make('rate', `${spec.label} reçoit trop de demandes : attends un instant puis réessaie.`);
  return make('server', `${spec.label} a coupé sa réponse${text ? ` : ${text.slice(0, 160)}` : ''}.`);
}

// A key pasted from a web page: without spaces, quotes or a "Bearer " prefix.
export function cleanKey(key) {
  return String(key ?? '')
    .replace(/^\s*(?:authorization:\s*)?bearer\s+/i, '')
    .replace(/\s+/g, '')
    .replace(/^["'`]+|["'`]+$/g, '');
}
