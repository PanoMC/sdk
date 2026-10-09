// The page loader of the widget runtime (doc 06 section 3.4). The build turns this file into `runtime/loader.js`; Pano serves it at
// `/api/v1/widgets/loader.js` (and at `/api/v1/widgets/runtime/loader.js`).
//
//   <script type="module" src="https://pano.example.com/api/v1/widgets/loader.js"></script>
//   <pano-market-goal></pano-market-goal>
//
// It has no static import: the runtime (Svelte, the host modules) is only loaded when the first `pano-*` widget tag of the
// index appears on the page, from the one URL every widget module also uses, so there is one Svelte per page.
//
// Assumption (the Kotlin side is unit PF-28): `index.json` lists `module` and the `styles` URLs either absolute, rooted (`/...`)
// or relative to the plugin's file base `<apiBase>/api/v1/plugins/<pluginId>/_/ui/` (widget modules sit in `widgets/`).

const PREFIX = 'pano-';
const w = window;
const here = import.meta.url;

// apiBase = the loader URL up to `/api/v1/`; without that shape (a loader opened from a plain folder) the runtime sits beside it.
const shape = /^(.*?)\/api\/v1\/(?:widgets\/)?(?:runtime\/)?[^/]*$/.exec(here);
const own = new URL(here);
const sameOrigin = own.origin === location.origin;
const detected = shape ? shape[1] : null;
// On the page's own origin a path prefix (`/pano`) is a reverse proxy: a relative base, which the host reads as "no CSRF".
const state = {
  apiBase: detected === null ? '' : sameOrigin ? detected.slice(own.origin.length) : detected,
  locale: undefined,
  urls: undefined,
  navigate: undefined,
  fetch: undefined,
  csrf: undefined,
};
const absolute = (base) => new URL(base || '/', location.href).href.replace(/\/$/, '');
const apiRoot = () => `${absolute(state.apiBase)}/api/v1/`;
const runtimeUrl = (file) => (detected === null ? here.replace(/[^/?#]*([?#].*)?$/, '') : `${apiRoot()}widgets/runtime/`) + file;

const script = [...document.querySelectorAll('script[src]')].find((s) => s.src === here);
const palette = script?.dataset.palette || 'light';
state.locale = script?.dataset.locale || undefined;

/** @type {any} */
let index = null;
/** @type {Promise<any> | null} */
let hostReady = null;
let started = false;
let generation = 0;
const seen = new Set();
const headSheets = new Set();

function headSheet(href) {
  if (!href || headSheets.has(href)) return;
  headSheets.add(href);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}

function fileUrl(pluginId, value, sub) {
  if (!value) return undefined;
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(value)) return value;
  if (value.startsWith('/')) return new URL(value, absolute(state.apiBase) + '/').href;
  return `${apiRoot()}plugins/${pluginId}/_/ui/${sub}${value}`;
}

function loadHost() {
  hostReady ??= import(runtimeUrl('host/index.js')).then((host) => {
    push(host);
    return host;
  });
  return hostReady;
}

function push(host) {
  const { apiBase, locale, urls, navigate, fetch, csrf } = state;
  host.configure({
    apiBase,
    siteUrl: index?.site?.url,
    ...(locale || index?.site?.locale ? { locale: locale || index.site.locale } : {}),
    ...(urls ? { urls } : {}),
    ...(navigate ? { navigate } : {}),
    ...(fetch ? { fetch } : {}),
    ...(csrf ? { csrf } : {}),
  });
}

async function define(tag) {
  const entry = index.widgets[tag];
  const [host, mod] = await Promise.all([loadHost(), import(fileUrl(entry.pluginId, entry.module, 'widgets/'))]);
  const styles = entry.styles ?? {};
  host.defineWidget(tag, mod, {
    ns: entry.ns,
    pluginId: entry.pluginId,
    session: entry.session,
    controllers: entry.controllers ? fileUrl(entry.pluginId, 'controllers.mjs', 'controllers/') : undefined,
    styles: {
      hash: styles.hash,
      fallback: fileUrl(entry.pluginId, styles.fallback, ''),
      icons: fileUrl(entry.pluginId, styles.icons, ''),
    },
  });
}

function tidy(el) {
  if (!el.hasAttribute('data-bs-theme')) el.setAttribute('data-bs-theme', palette);
}

function scan(root) {
  const gen = generation;
  const nodes = root.nodeType === 1 && root.localName.startsWith(PREFIX) ? [root] : [];
  if (root.querySelectorAll) nodes.push(...root.querySelectorAll('*'));
  for (const el of nodes) {
    const tag = el.localName;
    if (!tag.startsWith(PREFIX) || !index.widgets[tag]) continue;
    tidy(el);
    if (seen.has(tag)) continue;
    seen.add(tag);
    headSheet(runtimeUrl('css/pano-tokens.css'));
    const icons = index.widgets[tag].styles?.icons;
    if (icons) headSheet(fileUrl(index.widgets[tag].pluginId, icons, ''));
    define(tag).catch((e) => {
      if (gen === generation) seen.delete(tag);
      console.warn(`[pano-widgets] ${tag} failed to load`, e);
    });
  }
}

async function start() {
  const gen = ++generation;
  try {
    const res = await (state.fetch ?? fetch)(`${apiRoot()}widgets/index.json`, { credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (gen !== generation) return;
    index = data;
  } catch (e) {
    console.warn('[pano-widgets] could not read the widget index', e);
    return;
  }
  if (hostReady) hostReady.then(push);
  if (!started) {
    started = true;
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) scan(n);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  seen.clear();
  scan(document);
}

w.PanoWidgets = {
  /** @param {{ apiBase?: string, locale?: string, urls?: Record<string,string>, navigate?: Function, fetch?: Function, csrf?: string }} [options] */
  configure(options = {}) {
    const apiChanged = options.apiBase !== undefined && options.apiBase !== state.apiBase;
    for (const key of Object.keys(state)) if (options[key] !== undefined) state[key] = options[key];
    if (hostReady) hostReady.then(push);
    if (apiChanged && index) {
      index = null;
      hostReady = null;
      start();
    }
    return { ...state };
  },
  /** Resolves with the host module once the first widget has loaded the runtime (rejects when there is no widget). */
  host: () => loadHost(),
};

// Module scripts that follow the loader (a `configure` call) run before DOMContentLoaded, so the first scan waits for it.
const go = () => setTimeout(start, 0);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true });
else go();
