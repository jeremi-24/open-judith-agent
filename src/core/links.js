// Links in Judith's answers: a document, an artifact or a design Claude made,
// or a web page. The voice never reads a URL aloud; the notch shows a card
// to open it instead.
const MARKDOWN_LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
const BARE_URL = /https?:\/\/[^\s)\]>»"']+/g;
const TRAILING = /[.,;:!?]+$/;

// claude.ai/artifact/… and claude.ai/code/artifact/…: Claude's own creations
// (documents, designs, decks and pages all live there).
const CREATION = /^https:\/\/claude\.ai\/(?:code\/)?artifact\//i;

export function isCreation(url) {
  return CREATION.test(url);
}

function defaultTitle(url, language) {
  if (isCreation(url)) return language === 'fr' ? 'Ta création' : 'Your creation';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// Every distinct link in a text, in order: [{ title, url, creation }].
export function findLinks(text, language = 'fr') {
  const found = new Map();
  const add = (url, title) => {
    const clean = url.replace(TRAILING, '');
    if (!found.has(clean)) found.set(clean, { title: title?.trim() || defaultTitle(clean, language), url: clean, creation: isCreation(clean) });
  };
  const source = String(text ?? '');
  for (const [, title, url] of source.matchAll(MARKDOWN_LINK)) add(url, title);
  for (const [url] of source.replace(MARKDOWN_LINK, ' ').matchAll(BARE_URL)) add(url);
  return [...found.values()];
}

// The text without its URLs, ready to be spoken and shown:
// "[Mon doc](https://…)" → "Mon doc", a bare URL → "le lien".
export function speakable(text, language = 'fr') {
  const word = language === 'fr' ? 'le lien' : 'the link';
  return String(text ?? '')
    .replace(MARKDOWN_LINK, '$1')
    .replace(BARE_URL, (url) => word + (url.match(TRAILING)?.[0] ?? ''))
    .replace(/^#+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}
