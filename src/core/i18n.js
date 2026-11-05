// Judith speaks French and English. The French sentence IS the key: the code
// and the pages keep their French text, and locales/en.js says what each one
// is in English. A test scans every page and every t("…") call, so a sentence
// without an English version cannot slip in (see test/i18n.test.js).
//
//   t("Je réfléchis…")                       → "Thinking…" in English
//   t("Étape {step}/{max}", { step, max })   → "Step 2/12"
//   translateDocument(document)              → every text, title, aria-label,
//                                              placeholder and alt of a page
import { EN } from './locales/en.js';

export const LANGUAGES = ['fr', 'en'];
export const DEFAULT_LANGUAGE = 'fr';

// The language of a system locale ("fr-FR", "en-US"…): French stays French, the rest is English.
export const detectLanguage = (locale) => (String(locale ?? '').toLowerCase().startsWith('fr') ? 'fr' : 'en');
export const normalizeLanguage = (language) => (LANGUAGES.includes(language) ? language : DEFAULT_LANGUAGE);

// Whitespace and apostrophes written two ways must not make two keys.
export const keyOf = (text) => String(text).replace(/\s+/g, ' ').replace(/[’‘]/g, "'").trim();
const ENGLISH = new Map(Object.entries(EN).map(([fr, en]) => [keyOf(fr), en]));

const fill = (text, vars) => (vars ? text.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole)) : text);

// A sentence in a language; French (or an unknown sentence) comes back as written.
export function translate(language, text, vars) {
  const source = String(text);
  if (language !== 'en') return fill(source, vars);
  return fill(ENGLISH.get(keyOf(source)) ?? source, vars);
}

// In a window, the preload already knows the language: sentences written at load time are right.
let current = (typeof window !== 'undefined' && LANGUAGES.includes(window.judith?.language) && window.judith.language) || DEFAULT_LANGUAGE;
export const setLanguage = (language) => {
  current = normalizeLanguage(language);
};
export const getLanguage = () => current;
export const t = (text, vars) => translate(current, text, vars);

// The locale to give to Intl and Date (dates, numbers).
export const localeOf = (language = current) => (language === 'en' ? 'en-US' : 'fr-FR');

const ATTRIBUTES = ['title', 'aria-label', 'placeholder', 'alt'];

// Translates a whole page in place (browser only). French pages are left untouched.
export function translateDocument(root = document, language = current) {
  const doc = root.ownerDocument ?? root;
  if (doc.documentElement) doc.documentElement.lang = language;
  if (language !== 'en') return;
  if (doc.title) doc.title = ENGLISH.get(keyOf(doc.title)) ?? doc.title;
  const walker = doc.createTreeWalker(root.body ?? root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let node = walker.currentNode; node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement?.tagName;
      if (parent === 'SCRIPT' || parent === 'STYLE') continue;
      const raw = node.nodeValue;
      const key = keyOf(raw);
      const english = key && ENGLISH.get(key);
      if (english) node.nodeValue = raw.replace(raw.trim(), english);
    } else {
      for (const attribute of ATTRIBUTES) {
        const value = node.getAttribute?.(attribute);
        const english = value && ENGLISH.get(keyOf(value));
        if (english) node.setAttribute(attribute, english);
      }
    }
  }
}
