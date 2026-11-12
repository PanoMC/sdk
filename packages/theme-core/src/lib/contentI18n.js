// Translatable admin content (ticket categories, ticket fields, the registration agreement, posts and
// post categories): picks the text of the UI's current language from an object's optional `i18n` (locale code -> { prop: text }).
// The rule must match the panel and the backend: the exact locale, then its language part ("tr" for
// "tr-TR"), then the default text. A blank or missing translation means "use the default".
// Without `i18n` (an older backend) every helper returns the default text.

const isFilled = (value) => typeof value === "string" && value.trim() !== "";

/**
 * The locale codes to try, in order: the exact code, then its language part.
 *
 * @param {string | null | undefined} locale
 * @returns {string[]}
 */
function candidates(locale) {
  if (typeof locale !== "string" || locale === "") return [];

  const language = locale.split(/[-_]/)[0];

  return language && language !== locale ? [locale, language] : [locale];
}

/**
 * The first non-blank `pick(texts[code])` over the candidate codes, or `undefined`.
 *
 * @param {Record<string, unknown> | null | undefined} texts
 * @param {string | null | undefined} locale
 * @param {(entry: any) => unknown} pick
 */
function lookup(texts, locale, pick) {
  if (!texts || typeof texts !== "object") return undefined;

  for (const code of candidates(locale)) {
    const value = pick(texts[code]);

    if (isFilled(value)) return /** @type {string} */ (value);
  }

  return undefined;
}

/**
 * A flat translation map (locale code -> text, e.g. `registerAgreementI18n`).
 *
 * @param {string | null | undefined} defaultText
 * @param {Record<string, string> | null | undefined} texts
 * @param {string | null | undefined} locale
 * @returns {string}
 */
export function localizedString(defaultText, texts, locale) {
  return lookup(texts, locale, (entry) => entry) ?? defaultText ?? "";
}

/**
 * `i18n[locale][prop]`, else `i18n[<language part>][prop]`, else the default text.
 *
 * @param {string | null | undefined} defaultText
 * @param {Record<string, Record<string, unknown>> | null | undefined} i18n
 * @param {string | null | undefined} locale
 * @param {string} prop
 * @returns {string}
 */
export function localized(defaultText, i18n, locale, prop) {
  return lookup(i18n, locale, (entry) => entry?.[prop]) ?? defaultText ?? "";
}

/**
 * The label of one option: `i18n[locale].options[value]` with the same fallback, else its own label.
 *
 * @param {{ value: string, label?: string }} option
 * @param {Record<string, Record<string, unknown>> | null | undefined} i18n
 * @param {string | null | undefined} locale
 * @returns {string}
 */
export function localizedOption(option, i18n, locale) {
  const value = option?.value;

  return lookup(i18n, locale, (entry) => entry?.options?.[value]) ?? option?.label ?? String(value ?? "");
}

/**
 * The readable value of a SELECT / MULTISELECT snapshot entry (`ticket.fields[i]`) in the given locale,
 * rebuilt from the option values in `value` (MULTISELECT joined with ", "). Other types (and an entry
 * none of whose values has a translation) keep the server's `display`.
 *
 * @param {{ type: string, value: unknown, display?: string, options?: { value: string, label: string }[],
 *   i18n?: Record<string, Record<string, unknown>> }} entry
 * @param {string | null | undefined} locale
 * @returns {string}
 */
export function localizedDisplay(entry, locale) {
  if (!entry) return "";

  const display = isFilled(entry.display) ? entry.display : null;

  if (entry.type !== "SELECT" && entry.type !== "MULTISELECT") return display ?? String(entry.value ?? "");

  const values = entry.type === "MULTISELECT" ? (Array.isArray(entry.value) ? entry.value : []) : [entry.value];
  const translated = values.some((value) => lookup(entry.i18n, locale, (item) => item?.options?.[value]) !== undefined);

  if (!translated && display !== null) return display;

  return values
    .map((value) => {
      const option = (entry.options ?? []).find((item) => item.value === value) ?? { value, label: String(value ?? "") };

      return localizedOption(option, entry.i18n, locale);
    })
    .join(", ");
}

/** A localized copy -> the object it was made from, so localizing again never stacks languages. */
const sources = new WeakMap();

const sourceOf = (object) => sources.get(object) ?? object;

const remember = (copy, source) => {
  sources.set(copy, source);
  return copy;
};

// Object keys, not string literals: the engine's fallback-CSS scanner reads string literals as class
// names (and "placeholder" is a Bootstrap class).
const OPTIONAL_FIELD_TEXTS = Object.keys({ placeholder: 0, help: 0 });

/**
 * A field definition with `label`, `placeholder`, `help` and the option labels in the given locale
 * (`i18n` is kept).
 *
 * @template {{ label?: string, placeholder?: string, help?: string, options?: { value: string, label: string }[],
 *   i18n?: Record<string, Record<string, unknown>> }} T
 * @param {T} definition
 * @param {string | null | undefined} locale
 * @returns {T}
 */
export function localizeField(definition, locale) {
  if (!definition || typeof definition !== "object") return definition;

  const source = sourceOf(definition);
  const i18n = source.i18n;
  const copy = { ...source, label: localized(source.label, i18n, locale, "label") };

  for (const prop of OPTIONAL_FIELD_TEXTS) {
    if (prop in source) copy[prop] = localized(source[prop], i18n, locale, prop);
  }
  if (Array.isArray(source.options)) {
    copy.options = source.options.map((option) => ({ ...option, label: localizedOption(option, i18n, locale) }));
  }

  return remember(copy, source);
}

/**
 * A ticket category with `title`, `description` and its `fields` in the given locale. A missing
 * category or the "-" placeholder of "no category" is returned as is.
 *
 * @template {{ title?: string, description?: string, fields?: any[], i18n?: Record<string, Record<string, unknown>> }} T
 * @param {T} category
 * @param {string | null | undefined} locale
 * @returns {T}
 */
export function localizeCategory(category, locale) {
  if (!category || typeof category !== "object") return category;

  const source = sourceOf(category);
  const copy = { ...source };

  if ("title" in source && source.title !== "-") copy.title = localized(source.title, source.i18n, locale, "title");
  if ("description" in source) copy.description = localized(source.description, source.i18n, locale, "description");
  if (Array.isArray(source.fields)) copy.fields = source.fields.map((field) => localizeField(field, locale));

  return remember(copy, source);
}

/**
 * @param {any[] | null | undefined} categories
 * @param {string | null | undefined} locale
 * @returns {any[]}
 */
export function localizeCategories(categories, locale) {
  return Array.isArray(categories) ? categories.map((category) => localizeCategory(category, locale)) : [];
}

/**
 * A post category with `title` and `description` in the given locale (`i18n` is kept). The "-"
 * placeholder of "no category" (a string or a `{ title: "-" }` object) is returned as is.
 *
 * @template T
 * @param {T} category
 * @param {string | null | undefined} locale
 * @returns {T}
 */
export function localizePostCategory(category, locale) {
  return localizeCategory(category, locale);
}

/**
 * A post with `title`, `text` (HTML, or the list's excerpt) and its `category` in the given locale.
 * `i18n` is kept, and localizing a localized copy again starts from the original post. A post-like
 * value that is not an object (the "-" of "no previous post") is returned as is.
 *
 * @template {{ title?: string, text?: string, category?: any, i18n?: Record<string, Record<string, unknown>> }} T
 * @param {T} post
 * @param {string | null | undefined} locale
 * @returns {T}
 */
export function localizePost(post, locale) {
  if (!post || typeof post !== "object") return post;

  const source = sourceOf(post);
  const copy = { ...source };

  if ("title" in source) copy.title = localized(source.title, source.i18n, locale, "title");
  if ("text" in source) copy.text = localized(source.text, source.i18n, locale, "text");
  if ("category" in source) copy.category = localizePostCategory(source.category, locale);

  return remember(copy, source);
}

/**
 * @param {any[] | null | undefined} posts
 * @param {string | null | undefined} locale
 * @returns {any[]}
 */
export function localizePosts(posts, locale) {
  return Array.isArray(posts) ? posts.map((post) => localizePost(post, locale)) : [];
}
