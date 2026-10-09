import { getLocaleFromNavigator, init as initI18n, locale, register, waitLocale } from "svelte-i18n";
import { get, writable } from "svelte/store";

import { browser } from "$app/environment";

import { base } from "$app/paths";
import ApiUtil from "$pano/lib/api.util.js";
import { mergeTranslationLayers } from "./translationLayers.js";

export const languageLoading = writable(false);
export const currentLanguage = writable(null);
export const Languages = writable({});

async function fetchLanguages(event) {
  const response = await ApiUtil.get({
    path: `/locales`,
    request: event
  });
  const locales = response.items ?? response.data;

  Languages.set(Object.fromEntries(locales.map(item => [item.code, item])));
}

export async function init(initialLocale, event) {
  await fetchLanguages(event);

  if (browser && !initialLocale) {
    initialLocale = get(locale);

    if (get(locale) === null) {
      initialLocale = getLocaleFromNavigator();
    }
  }

  const language = getLanguageByLocale(initialLocale);
  const languageToLoad = language || get(Languages)["en-US"];

  const enUS = get(Languages)["en-US"];

  // Load fallback and target language in parallel (they are independent)
  if (languageToLoad.code === enUS.code) {
    await loadLanguage(enUS, event);
  } else {
    await Promise.all([
      loadLanguage(enUS, event),
      loadLanguage(languageToLoad, event)
    ]);
  }

  currentLanguage.set(languageToLoad);

  await waitLocale();

  initI18n({
    fallbackLocale: "en-US",
    initialLocale: languageToLoad.code
  });

  return languageToLoad;
}

// Re-applies a resolved language synchronously. On the server the stores above are process-wide,
// so concurrent requests with different locales overwrite each other between `init` (awaits) and
// the render. Call this at the top of the root layout's component init (render is synchronous).
export function activateLanguage(language) {
  if (!language) {
    return;
  }

  locale.set(language.code);
  currentLanguage.set(language);
}

export function getAcceptedLanguage(headers) {
  if (
    typeof headers.get("accept-language") === "undefined" ||
    headers.get("accept-language") == null
  ) {
    return "";
  }

  return headers.get("accept-language").split(",")[0];
}

/**
 * `lang/<locale>.plugins.json` is optional: any failure (missing file, non-200, bad JSON) is `{}`.
 * @param {(url: string) => Promise<any>} useFetch
 * @param {string} code
 */
async function fetchThemePluginTexts(useFetch, code) {
  try {
    const response = await useFetch(base + `/theme-api/languages/${code}.plugins.json`);

    if (!response || response.ok === false || (response.status != null && response.status !== 200)) {
      return {};
    }

    const body = await response.json();

    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch {
    return {};
  }
}

/**
 * The installed plugins behind the `plugins.<id>` keys of the translations API: the namespace of
 * an id is the id without a leading `pano-plugin-` (doc 01 section 1).
 * @param {Record<string, any>} apiData
 * @returns {{ id: string, namespace: string }[]}
 */
function pluginsOf(apiData) {
  const tree = apiData?.plugins;

  if (!tree || typeof tree !== "object") {
    return [];
  }

  return Object.keys(tree).map((id) => ({ id, namespace: id.replace(/^pano-plugin-/, "") }));
}

export async function loadLanguage(language, event) {
  const useFetch = event ? event.fetch : fetch;

  const [localTranslationsResponse, translationsResponse, themePlugins] = await Promise.all([
    useFetch(base + `/theme-api/languages/${language.code}.json`),
    ApiUtil.get({
      path: `/locales/${language.code}/translations/types/THEME`,
      request: event
    }),
    fetchThemePluginTexts(useFetch, language.code)
  ]);

  const languageFile = await localTranslationsResponse.json();
  const ok = !translationsResponse.error;
  const api = ok ? translationsResponse.data ?? {} : {};

  // Plugin default < theme file < theme's plugin overrides < admin edit (doc 03 section 5.3).
  // The merged dictionary is flat: svelte-i18n resolves a flat key first, so dotted plugin ids work.
  const translations = mergeTranslationLayers({
    theme: languageFile,
    themePlugins,
    api,
    pluginAdminKeys: ok ? translationsResponse.meta?.pluginAdminKeys : undefined,
    plugins: pluginsOf(api)
  });

  register(language.code, async () => translations);

  await waitLocale(language.code);

  if (language.derivatives) {
    for (const derivative of language.derivatives) {
      register(derivative, async () => translations);
      await waitLocale(language.code);
    }
  }
}

export async function changeLanguage(language) {
  if (get(currentLanguage) === language) {
    return;
  }

  languageLoading.set(true);

  await loadLanguage(language);

  locale.set(language.code);
  currentLanguage.set(language);

  languageLoading.set(false);
}

export function getLanguageByLocale(locale) {
  let foundLanguage = null;
  const languages = get(Languages);

  Object.keys(languages).forEach((key) => {
    const language = languages[key];
    if (language.code === locale) {
      foundLanguage = language;
    }
  });

  return foundLanguage;
}
