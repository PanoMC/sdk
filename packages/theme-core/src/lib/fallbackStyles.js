// Engine side of the scoped fallback stylesheet (doc 03 section 4.4).
//
// A theme that sets `provides: { bootstrap: false }` gets, for every DEFAULT plugin view it did not override, a
// wrapper `<div class="pano-fb" data-pano-fb="<ns>" style="display: contents">` and a link to the plugin's own
// `client/fallback.css` (Bootstrap subset, scoped to that wrapper). This file holds everything that has no Svelte
// in it: the set of stylesheets a render needs, the href of each, and `wrap`, which decides per view.
//
// `FallbackScope.svelte` is handed in by the caller (this file stays loadable without the Svelte compiler).
import { getContext } from "svelte";
import { SvelteSet } from "svelte/reactivity";

/** Context key of the scope: the namespace of the fallback scope a view renders in, or null inside a stop scope. */
export const SCOPE_CONTEXT = "pano:fb";
/** Context key of the stylesheet store `RootLayout.svelte` creates. */
export const STYLES_CONTEXT = "pano:fb-styles";
/** Attribute the links carry, so the browser store starts with what the server already rendered. */
export const STYLE_ATTRIBUTE = "data-pano-fb-style";

/** The scope (and the stylesheet key) of an injected view of a plugin that is not on the new model. */
export const LEGACY_KEY = "legacy";

/** Roots that cannot sit inside a wrapper `div` (a table-row view gets no wrapper, doc 03 section 4.4 step 3). */
const TABLE_ROOTS = new Set(["tr", "td", "th", "tbody", "thead", "tfoot", "col", "colgroup", "caption"]);

/** The engine's own views (names without a colon) have one engine sheet and nothing else. */
const ENGINE_ENTRY = Object.freeze({
  id: "pano",
  ns: "pano",
  styles: Object.freeze({ fallback: "assets/css/pano-fallback.css" }),
  roots: Object.freeze({}),
});

/**
 * @typedef {{ fallback?: string, own?: string, hash?: string, icons?: boolean }} StyleMeta
 * @typedef {{ id: string, ns: string, styles?: StyleMeta, roots?: Record<string, string[]> }} StyleEntry
 * @typedef {Record<string, StyleEntry>} StyleTable   namespace -> what the engine knows of the plugin's styles
 * @typedef {{ keys: Set<string>, add(key: string): void }} FallbackStyles
 */

// ---------------------------------------------------------------------------
// The set of stylesheets a render needs
// ---------------------------------------------------------------------------

/**
 * One per render (`RootLayout.svelte` creates it and puts it in context).
 *
 * Server: a plain `Set`, `add` is synchronous (the head is rendered after the page, so it sees every key).
 * Client: a `SvelteSet` that starts with the links the server rendered, `add` is deferred with `queueMicrotask`
 * (a view adds its key while it renders, which must not write reactive state), and keys are never removed during
 * the session, so destroying the first view that needed a sheet does not take it away from the others.
 *
 * @param {{ browser?: boolean }} [options]  `browser` defaults to "a document exists"
 * @returns {FallbackStyles}
 */
export function createFallbackStyles({ browser = typeof document !== "undefined" } = {}) {
  if (!browser) {
    const keys = new Set();

    return { keys, add: (key) => void keys.add(key) };
  }

  const keys = new SvelteSet();

  try {
    for (const link of document.head.querySelectorAll(`link[${STYLE_ATTRIBUTE}]`)) {
      keys.add(link.getAttribute(STYLE_ATTRIBUTE));
    }
  } catch {
    // no document (a test without one): start empty
  }

  return {
    keys,
    add(key) {
      if (keys.has(key)) return;

      queueMicrotask(() => keys.add(key));
    },
  };
}

/** The store a render without a `RootLayout` (a test, a widget) still needs somewhere to put keys. */
let activeStyles = null;

/**
 * `RootLayout.svelte` calls this once per render. A server render is synchronous, so the store of the render in
 * progress is the one every `wrap` call of that render means; the browser has one store for the whole session.
 * @param {FallbackStyles | null} styles
 */
export function setActiveFallbackStyles(styles) {
  activeStyles = styles;
}

/**
 * key -> href. ns: `${base}/plugins/<id>/resources/plugin-ui/client/fallback.css?v=<hash>`;
 * `own:<ns>`: `.../client/plugin.css?v=<hash>`; `pano`: `${base}/assets/css/pano-fallback.css`;
 * `icons`: `${base}/assets/css/pano-fallback-icons.css`; `legacy`: `${base}/assets/css/pano-fallback-legacy.css`. null = a key nothing can serve.
 * @param {string} key
 * @param {StyleTable} plugins
 * @param {string} [base]  SvelteKit's `base` path
 * @returns {string | null}
 */
export function fallbackHref(key, plugins, base = "") {
  if (key === "icons") return `${base}/assets/css/pano-fallback-icons.css`;
  if (key === "pano") return `${base}/assets/css/pano-fallback.css`;
  if (key === LEGACY_KEY) return `${base}/assets/css/pano-fallback-legacy.css`;

  const own = key.startsWith("own:");
  const entry = lookupEntry(plugins, own ? key.slice("own:".length) : key);
  const file = own ? entry?.styles?.own : entry?.styles?.fallback;

  if (!entry || typeof file !== "string" || !file) return null;

  const hash = entry.styles?.hash;
  const query = typeof hash === "string" && hash ? `?v=${encodeURIComponent(hash)}` : "";

  return `${base}/plugins/${encodeURIComponent(entry.id)}/resources/plugin-ui/${file.replace(/^\/+/, "")}${query}`;
}

/** An entry by namespace, or by plugin id (a view named `<pluginId>:<Name>` is the alias of `<ns>:<Name>`). */
function lookupEntry(table, ns) {
  if (!table || typeof table !== "object") return null;
  if (table[ns]) return table[ns];

  for (const entry of Object.values(table)) {
    if (entry && entry.id === ns) return entry;
  }

  return null;
}

/**
 * What the theme process knows of every plugin's styles, as plain data the browser can be sent
 * (`pano-plugin.json` is read on the server only). Only plugins with a namespace take part.
 * @param {Iterable<{ id: string, namespace?: string, styles?: any, views?: any }>} plugins
 * @returns {StyleTable}
 */
export function buildStyleTable(plugins) {
  /** @type {StyleTable} */
  const table = {};

  for (const plugin of plugins) {
    if (!plugin || typeof plugin.namespace !== "string" || !plugin.namespace) continue;

    /** @type {StyleEntry} */
    const entry = { id: plugin.id, ns: plugin.namespace };
    const styles = plugin.styles;

    if (styles && typeof styles === "object") {
      entry.styles = {};

      for (const key of ["fallback", "own", "hash"]) {
        if (typeof styles[key] === "string" && styles[key]) entry.styles[key] = styles[key];
      }

      if (styles.icons === true) entry.styles.icons = true;
    }

    const views = plugin.views;

    if (views && typeof views === "object") {
      entry.roots = {};

      for (const [name, view] of Object.entries(views)) {
        if (Array.isArray(view?.roots)) entry.roots[name] = view.roots.filter((root) => typeof root === "string");
      }
    }

    table[plugin.namespace] = entry;
  }

  return table;
}

// ---------------------------------------------------------------------------
// wrap
// ---------------------------------------------------------------------------

/** `getContext` that answers undefined outside a component (a preload, a test) instead of throwing. */
function readContext(key) {
  try {
    return getContext(key);
  } catch {
    return undefined;
  }
}

/**
 * @typedef {{ mode: "fallback" | "stop" | null, ns: string }} ScopePlan
 *
 * @typedef {object} WrapperDeps
 * @property {Function} FallbackScope  `routes`-independent wrapper component (`FallbackScope.svelte`)
 * @property {() => StyleTable} getTable  the styles of every plugin, by namespace
 * @property {() => { bootstrap: boolean, fontawesome: boolean }} getProvides
 * @property {(key: string) => any} [readScope]  reads a context key (default: Svelte's `getContext`, guarded)
 * @property {boolean} [dev]  log a plugin without fallback styles once
 * @property {(message: string) => void} [warn]
 */

/**
 * `views.wrap` of the pano context.
 *
 * `plan(name, source, inside?)` applies steps 1-2 and 5 of the table in doc 03 section 4.4 (the stylesheets a view
 * needs) and returns what the view gets: a `fallback` scope, a `stop` scope or nothing. `wrap` turns the plan into a
 * component: the component itself, or `(anchor, props) => FallbackScope(anchor, { Component, ns, mode, props })`
 * with the plan on it as `.scope`.
 *
 * | Step | Condition | Result |
 * |---|---|---|
 * | 1 | plugin has `styles.own` | `styles.add('own:' + ns)` (every theme) |
 * | 2 | `default`, plugin `styles.icons`, `provides.fontawesome === false` | `styles.add('icons')` |
 * | 3 | `provides.bootstrap`, or no `styles.fallback`, or the view's `roots` holds a table root | the component |
 * | 4 | `default` and already inside its own plugin's scope | the component |
 * | 5 | `default` otherwise | `styles.add(ns)`; `fallback` scope |
 * | 6 | `override` and inside a scope | `stop` scope |
 * | 7 | `override` otherwise | the component |
 *
 * @param {WrapperDeps} deps
 * `wrapInjected(module)` is `wrap` for what a registered item's `component` resolved to (a nav item, a sidebar widget,
 * a hook; doc 03 section 4.4, call sites). A module that carries `__panoView` (`loadForInjection` puts it there) is a
 * named view and goes through `wrap`. Anything else is the legacy form (`component` of a plugin that is not on the
 * new model): in a theme without Bootstrap it gets the one `legacy` scope (the whole Bootstrap base, scoped) and, with
 * `provides.fontawesome === false`, the icon sheet.
 *
 * @returns {{ wrap: (name: string, Component: Function, source: "default" | "override") => Function,
 *             wrapInjected: (module: any) => Function,
 *             plan: (name: string, source: "default" | "override", inside?: unknown) => ScopePlan }}
 */
export function createViewWrapper({ FallbackScope, getTable, getProvides, readScope = readContext, dev = false, warn = console.warn }) {
  /** @type {Set<string>} */
  const warned = new Set();

  const store = () => readScope(STYLES_CONTEXT) ?? activeStyles;

  function plan(name, source, inside = readScope(SCOPE_CONTEXT)) {
    const colon = typeof name === "string" ? name.indexOf(":") : -1;
    const requested = colon > 0 ? name.slice(0, colon) : "pano";
    const viewName = colon > 0 ? name.slice(colon + 1) : name;
    const entry = requested === "pano" ? ENGINE_ENTRY : lookupEntry(getTable(), requested);
    const ns = entry?.ns ?? requested;
    const styles = entry?.styles;
    const provides = getProvides();
    const sheets = store();

    // 1, 2
    if (styles?.own) sheets?.add(`own:${ns}`);
    if (source === "default" && styles?.icons && provides.fontawesome === false) sheets?.add("icons");

    // 3
    if (provides.bootstrap) return { mode: null, ns };

    if (!styles?.fallback) {
      if (dev && entry && !styles && !warned.has(ns)) {
        warned.add(ns);
        warn(`[theme-core] ${entry.id} has no fallback styles — rebuild it with @panomc/plugin-kit`);
      }

      return { mode: null, ns };
    }

    if (entry.roots?.[viewName]?.some((root) => TABLE_ROOTS.has(root))) return { mode: null, ns };

    if (source === "default") {
      // 4
      if (inside === ns) return { mode: null, ns };

      // 5
      sheets?.add(ns);

      return { mode: "fallback", ns };
    }

    // 6, 7
    return typeof inside === "string" ? { mode: "stop", ns } : { mode: null, ns };
  }

  function wrap(name, Component, source) {
    const { mode, ns } = plan(name, source);

    if (!mode) return Component;

    const scoped = (anchorOrPayload, props) => FallbackScope(anchorOrPayload, { Component, ns, mode, props });

    // a caller that mounts the view itself (the plugin page in the browser) puts the scope on its own element
    scoped.scope = { mode, ns };

    return scoped;
  }

  function wrapInjected(module) {
    const Component = module?.default ?? module;

    if (module && typeof module === "object" && typeof module.__panoView === "string" && module.__panoView) {
      return wrap(module.__panoView, Component, module.__panoSource === "override" ? "override" : "default") ?? Component;
    }

    const provides = getProvides();

    if (provides.bootstrap) return Component;

    const sheets = store();

    sheets?.add(LEGACY_KEY);
    if (provides.fontawesome === false) sheets?.add("icons");

    if (readScope(SCOPE_CONTEXT) === LEGACY_KEY) return Component;

    const scoped = (anchorOrPayload, props) =>
      FallbackScope(anchorOrPayload, { Component, ns: LEGACY_KEY, mode: "fallback", props });

    scoped.scope = { mode: "fallback", ns: LEGACY_KEY };

    return scoped;
  }

  return { wrap, wrapInjected, plan };
}
