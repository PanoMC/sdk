/**
 * Controller registry (doc 02 §2).
 *
 * State lives on `globalThis.__PANO_CONTROLLERS__` so a plugin bundle that carries its own copy of this file
 * (the plugin server bundle has no externals) still talks to the same registry. Nothing request-bound is ever
 * stored here: on the server a host is created per call from `opts.event` and nothing is cached.
 *
 * A definition is what `defineController()` of `@panomc/plugin-kit` returns:
 * `{ name, version, scope?, eager?, load?, create(host, params?, initial?, ctx?) }`
 * `create` returns a Controller `{ name, version, get, subscribe, actions, destroy }`. The registry passes a fourth
 * argument `ctx = { use(siblingName) }` so a controller can reach a sibling of the same plugin on the same host.
 *
 * Unknown names and version mismatches never throw: `use()` returns null and `onMismatch` listeners are told.
 */

const GLOBAL_KEY = '__PANO_CONTROLLERS__';

/**
 * @typedef {Object} ControllerDefinition
 * @property {string} name
 * @property {number} version
 * @property {'app'|'instance'} [scope]
 * @property {boolean} [eager]
 * @property {(c:{host:any, params:object}) => Promise<object>} [load]
 * @property {(host:any, params?:object, initial?:object, ctx?:{use:(name:string)=>any}) => any} create
 * @property {(patch:object) => any} [createSample]
 */

/**
 * @typedef {Object} UseOptions
 * @property {number} [version]
 * @property {object} [params]
 * @property {object} [initial]
 * @property {any} [event]
 */

function getState() {
  let s = globalThis[GLOBAL_KEY];
  if (!s) {
    s = {
      /** @type {Map<string, {def: ControllerDefinition, pluginId: string, namespace: string, key: string}>} */
      defs: new Map(),
      /** @type {Map<string, string>} namespace -> pluginId */
      plugins: new Map(),
      /** @type {Map<string, any>} browser app-scope cache by full name */
      cache: new Map(),
      /** @type {Array<string>} eager names waiting for a host factory */
      pendingEager: [],
      /** @type {Record<string, number>} */
      pins: {},
      /** @type {Record<string, object> | null} */
      samples: null,
      /** @type {Map<string, any>} */
      sampleCache: new Map(),
      /** @type {null | ((event?: any) => any)} */
      hostFactory: null,
      browserHost: null,
      /** @type {Array<(m: object) => void>} */
      mismatch: [],
      /** @type {Set<string>} */
      warned: new Set(),
    };
    globalThis[GLOBAL_KEY] = s;
  }
  return s;
}

function isBrowser() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function warnOnce(key, message) {
  const s = getState();
  if (s.warned.has(key)) return;
  s.warned.add(key);
  console.warn(message);
}

function scopeOf(def) {
  return def.scope === 'instance' ? 'instance' : 'app';
}

function safeDestroy(controller) {
  try {
    controller?.destroy?.();
  } catch (e) {
    console.error('[PanoSDK] controller destroy failed', e);
  }
}

function hostFor(event) {
  const s = getState();
  if (!s.hostFactory) return null;
  if (isBrowser()) {
    if (!s.browserHost) s.browserHost = s.hostFactory(event);
    return s.browserHost;
  }
  return s.hostFactory(event);
}

function report(info) {
  const s = getState();
  for (const fn of [...s.mismatch]) {
    try {
      fn(info);
    } catch (e) {
      console.error('[PanoSDK] onMismatch listener failed', e);
    }
  }
}

/**
 * Looks the name up and applies the version rule. Returns the entry or null (already reported).
 * @param {string} name
 * @param {UseOptions} [opts]
 */
function resolveEntry(name, opts) {
  const s = getState();
  const entry = s.defs.get(name);

  if (!entry) {
    warnOnce(
      `missing:${name}`,
      `controller '${name}' is not registered - is ${pluginHint(name)} installed and enabled?`,
    );
    return null;
  }

  const wanted = opts?.version ?? s.pins[name];

  if (wanted !== undefined && wanted !== null && wanted !== entry.def.version) {
    warnOnce(
      `mismatch:${name}:${wanted}:${entry.def.version}`,
      `'${name}' is at version ${entry.def.version}, this theme was written for ${wanted} - run theme-core check`,
    );
    report({ kind: 'controller', name, wanted, available: entry.def.version });
    return null;
  }

  return entry;
}

function pluginHint(name) {
  const ns = String(name).split('/')[0];
  const s = getState();
  return s.plugins.get(ns) ?? `pano-plugin-${ns}`;
}

function makeCtx(entry, host) {
  return {
    use(sibling) {
      const full = `${entry.namespace}/${sibling}`;
      const found = getState().defs.get(full);
      if (!found) return null;
      return acquire(found, full, {}, host, true);
    },
  };
}

/**
 * Creates or fetches the controller for an entry on a given host.
 * `cacheable` is false on the server (nothing is ever cached there).
 */
function acquire(entry, full, opts, host, cacheable) {
  const s = getState();
  const def = entry.def;
  const canCache = cacheable && isBrowser() && scopeOf(def) === 'app';

  if (canCache && s.cache.has(full)) return s.cache.get(full);

  const controller = def.create(host, opts?.params ?? {}, opts?.initial, makeCtx(entry, host));

  if (canCache) s.cache.set(full, controller);
  return controller;
}

function createSampleController(entry, full, patch) {
  const def = entry.def;
  if (typeof def.createSample === 'function') return def.createSample(patch ?? {});

  const guest = {
    baseUrl: '',
    browser: false,
    request: async () => ({ error: { code: 'NULL_HOST' } }),
    session: () => ({ user: null, csrfToken: null }),
    locale: () => undefined,
    onSession: () => () => {},
    t: (key) => key,
    toast: () => {},
    storage: () => null,
    now: () => Date.now(),
    navigate: () => {},
    feature: () => false,
    loginUrl: () => '/login',
    registerUrl: () => '/register',
  };

  let base = null;
  let initial = {};
  let actionNames = [];
  try {
    base = def.create(guest, {}, undefined, { use: () => null });
    initial = base.get() ?? {};
    actionNames = Object.keys(base.actions ?? {});
  } catch (e) {
    console.warn(`[PanoSDK] sample state of '${full}' could not read the initial state`, e);
  } finally {
    safeDestroy(base);
  }

  const state = { ...initial, ...(patch ?? {}) };
  const calls = [];
  const actions = {};
  for (const n of actionNames) {
    actions[n] = (...args) => {
      calls.push({ name: n, args });
      return { ok: true };
    };
  }

  return {
    name: full,
    version: def.version,
    get: () => state,
    subscribe(run) {
      run(state);
      return () => {};
    },
    actions,
    calls,
    destroy() {},
  };
}

function startEager(full) {
  const s = getState();
  const entry = s.defs.get(full);
  if (!entry || !entry.def.eager || scopeOf(entry.def) !== 'app') return;

  const host = hostFor();
  if (!host) {
    if (!s.pendingEager.includes(full)) s.pendingEager.push(full);
    return;
  }

  try {
    acquire(entry, full, {}, host, true);
  } catch (e) {
    console.error(`[PanoSDK] eager controller '${full}' failed to start`, e);
  }
}

/**
 * @param {string} pluginId
 * @param {string} namespace
 * @param {Record<string, ControllerDefinition> | ControllerDefinition[]} definitions
 */
export function register(pluginId, namespace, definitions) {
  const s = getState();
  s.plugins.set(namespace, pluginId);

  const list = Array.isArray(definitions)
    ? definitions.map((def) => [def?.name, def])
    : Object.entries(definitions ?? {}).map(([key, def]) => [def?.name ?? key, def]);

  for (const [key, def] of list) {
    if (!def || typeof def.create !== 'function' || !key) {
      console.warn(`[PanoSDK] ${pluginId}: skipped a controller definition without name or create()`);
      continue;
    }

    const full = `${namespace}/${key}`;

    if (s.cache.has(full)) {
      safeDestroy(s.cache.get(full));
      s.cache.delete(full);
    }

    s.defs.set(full, { def, pluginId, namespace, key });
    s.warned.delete(`missing:${full}`);

    if (isBrowser()) startEager(full);
  }
}

/** Stops cached (eager and used) controllers, clears definitions and the cache. Host, pins, samples and listeners stay. */
export function reset() {
  const s = getState();
  for (const controller of s.cache.values()) safeDestroy(controller);
  s.cache.clear();
  s.sampleCache.clear();
  s.defs.clear();
  s.plugins.clear();
  s.pendingEager = [];
  s.warned.clear();
}

/**
 * @param {string} name `<namespace>/<controller>`
 * @param {UseOptions} [opts]
 * @returns {any | null}
 */
export function use(name, opts) {
  const s = getState();
  const entry = resolveEntry(name, opts);
  if (!entry) return null;

  if (s.samples) {
    if (!s.sampleCache.has(name)) {
      s.sampleCache.set(name, createSampleController(entry, name, s.samples[name]));
    }
    return s.sampleCache.get(name);
  }

  const host = hostFor(opts?.event);
  if (!host) {
    warnOnce('nohost', '[PanoSDK] controllers.use() called before a host factory was set');
    return null;
  }

  return acquire(entry, name, opts, host, true);
}

/**
 * @param {string} name
 * @param {UseOptions} [opts]
 * @returns {Promise<object | null>}
 */
export async function load(name, opts) {
  const entry = resolveEntry(name, opts);
  if (!entry) return null;
  if (typeof entry.def.load !== 'function') return {};

  const host = hostFor(opts?.event);
  if (!host) {
    warnOnce('nohost', '[PanoSDK] controllers.load() called before a host factory was set');
    return null;
  }

  return entry.def.load({ host, params: opts?.params ?? {} });
}

/**
 * @param {string} name
 * @param {number} [version]
 */
export function has(name, version) {
  const entry = getState().defs.get(name);
  if (!entry) return false;
  return version === undefined || version === null || entry.def.version === version;
}

/** @returns {Array<{name:string, version:number, pluginId:string, scope:'app'|'instance'}>} */
export function list() {
  return [...getState().defs.entries()].map(([name, e]) => ({
    name,
    version: e.def.version,
    pluginId: e.pluginId,
    scope: scopeOf(e.def),
  }));
}

/** Plugin id registered for a namespace, or undefined. */
export function pluginIdOf(namespace) {
  return getState().plugins.get(namespace);
}

/** @param {(event?: any) => any} fn */
export function setHostFactory(fn) {
  const s = getState();
  s.hostFactory = typeof fn === 'function' ? fn : null;
  s.browserHost = null;

  if (s.hostFactory && isBrowser()) {
    const pending = s.pendingEager;
    s.pendingEager = [];
    for (const full of pending) startEager(full);
  }
}

/** @param {Record<string, number> | null} map */
export function setThemePins(map) {
  getState().pins = { ...(map ?? {}) };
}

/** @param {Record<string, object> | null} map */
export function setSamples(map) {
  const s = getState();
  // any map (even an empty one) turns sample mode on for every name; null turns it off
  s.samples = map ? { ...map } : null;
  s.sampleCache.clear();
}

/**
 * @param {(m:{kind:'controller', name:string, wanted:number, available:number}) => void} fn
 * @returns {() => void}
 */
export function onMismatch(fn) {
  const s = getState();
  s.mismatch.push(fn);
  return () => {
    s.mismatch = s.mismatch.filter((l) => l !== fn);
  };
}

/** The object the engine exposes as `pano.controllers`. */
export const controllers = {
  register,
  reset,
  use,
  load,
  has,
  list,
  pluginIdOf,
  setHostFactory,
  setThemePins,
  setSamples,
  onMismatch,
};

export default controllers;
