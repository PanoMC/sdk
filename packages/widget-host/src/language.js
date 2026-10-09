// `@panomc/sdk/utils/language` outside a theme (doc 06 section 3.2): the real svelte-i18n of the shared runtime, with messages
// from the core's THEME translations and the plugin's own `_/translations/<locale>`, each fetched once per page.
import { addMessages, getLocaleFromNavigator, init as initI18n, locale, _ } from 'svelte-i18n';
import { get, writable } from 'svelte/store';
import { getClient, getConfig } from './config.js';

export { _ };

export const languageLoading = writable(false);
export const currentLanguage = writable(null);
export const Languages = writable({});

const FALLBACK = 'en-US';

/** @type {Map<string, Promise<object>>} */
const coreMessages = new Map();
/** @type {Map<string, Promise<object>>} */
const pluginMessages = new Map();
/** @type {Promise<any> | null} */
let initializing = null;
let initialized = false;

function flatten(obj, prefix = '', out = {}) {
  for (const key of Object.keys(obj ?? {})) {
    const value = obj[key];
    const name = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, name, out);
    else out[name] = value;
  }
  return out;
}

function unflatten(flat) {
  const out = {};
  for (const [flatKey, value] of Object.entries(flat)) {
    const keys = flatKey.split('.');
    keys.reduce((acc, key, i) => {
      if (i === keys.length - 1) acc[key] = value;
      else acc[key] = acc[key] && typeof acc[key] === 'object' ? acc[key] : {};
      return acc[key];
    }, out);
  }
  return out;
}

/** A list in any of the shapes the API has used: an array, `{ items }` or `{ data }`. */
function listOf(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.items)) return body.items;
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

async function getJson(path) {
  const result = await getClient().request({ method: 'GET', path: `/api/v1${path}` });
  return result.ok ? result.data : null;
}

async function fetchLanguages() {
  const list = listOf(await getJson('/locales'));
  Languages.set(Object.fromEntries(list.filter((l) => l?.code).map((l) => [l.code, l])));
}

export function getLanguageByLocale(code) {
  return Object.values(get(Languages)).find((l) => l.code === code) ?? null;
}

export function getAcceptedLanguage(headers) {
  const value = headers?.get?.('accept-language');
  return value ? value.split(',')[0] : '';
}

/** Core text of the active front-end: `GET /api/v1/locales/<code>/translations/types/THEME`, once per page. */
export function loadLanguage(language) {
  const code = language.code;
  if (!coreMessages.has(code)) {
    coreMessages.set(
      code,
      (async () => {
        const body = await getJson(`/locales/${encodeURIComponent(code)}/translations/types/THEME`);
        const messages = body && typeof body === 'object' ? (body.data ?? body.translations ?? body) : {};
        const { result: _r, ...rest } = messages;
        const nested = unflatten(flatten(rest));
        addMessages(code, nested);
        for (const derivative of language.derivatives ?? []) addMessages(derivative, nested);
        return nested;
      })().catch(() => ({})),
    );
  }
  return coreMessages.get(code);
}

/**
 * The plugin's text for a locale: `GET /api/v1/plugins/<pluginId>/_/translations/<locale>`, once per page and locale.
 * @param {string} pluginId
 * @param {string} [code] default: the active locale
 */
export function loadPluginTranslations(pluginId, code = get(locale) || getConfig().locale || FALLBACK) {
  const key = `${pluginId}:${code}`;
  if (!pluginMessages.has(key)) {
    pluginMessages.set(
      key,
      (async () => {
        const body = await getJson(`/plugins/${encodeURIComponent(pluginId)}/_/translations/${encodeURIComponent(code)}`);
        const translations = body?.translations;
        if (!translations || typeof translations !== 'object') return {};
        // the subtree under `plugins.<id>` of the full text, or already the full tree
        const nested = translations.plugins ? translations : { plugins: { [pluginId]: translations } };
        addMessages(code, nested);
        return nested;
      })().catch(() => ({})),
    );
  }
  return pluginMessages.get(key);
}

/** Activates the locale for a language object: loads its text first. */
export async function init(initialLocale) {
  await fetchLanguages();

  const wanted = initialLocale || getConfig().locale || get(locale) || getLocaleFromNavigator() || FALLBACK;
  const languages = get(Languages);
  const language = getLanguageByLocale(wanted) ?? languages[FALLBACK] ?? { code: wanted };
  const fallback = languages[FALLBACK] ?? { code: FALLBACK };

  await Promise.all([loadLanguage(fallback), language.code === fallback.code ? null : loadLanguage(language)]);

  currentLanguage.set(language);
  initI18n({ fallbackLocale: FALLBACK, initialLocale: language.code });
  initialized = true;
  return language;
}

/** Runs `init` once per page; never rejects. */
export function ensureLanguage() {
  if (!initializing) {
    initializing = init().catch(() => {
      if (!initialized) {
        initI18n({ fallbackLocale: FALLBACK, initialLocale: getConfig().locale || FALLBACK });
        initialized = true;
      }
      return null;
    });
  }
  return initializing;
}

export async function changeLanguage(language) {
  if (get(currentLanguage) === language) return;

  languageLoading.set(true);
  try {
    await loadLanguage(language);
    locale.set(language.code);
    currentLanguage.set(language);
  } finally {
    languageLoading.set(false);
  }
}

/**
 * Text for a key with a built-in default; safe before the locale is initialised.
 * @param {string} key @param {string} fallback @param {Record<string, any>} [values]
 */
export function translate(key, fallback, values) {
  try {
    return get(_)(key, { default: fallback, values });
  } catch {
    return fallback;
  }
}

/** Forgets what was fetched (tests). */
export function resetLanguage() {
  coreMessages.clear();
  pluginMessages.clear();
  initializing = null;
  initialized = false;
  currentLanguage.set(null);
  Languages.set({});
}
