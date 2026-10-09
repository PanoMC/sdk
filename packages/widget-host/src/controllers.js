// `@panomc/sdk/controllers` in a widget page (doc 06 section 3.2, doc 02 section 2): the same `plugin` / `useController` / `reactive`
// over the page's controller registry and one widget `ControllerHost`.
//
// The registry file is the SDK's own (state on `globalThis.__PANO_CONTROLLERS__`), so a plugin's `controllers.mjs` registers
// into the same place whatever bundle it is imported from.
import { createSubscriber } from 'svelte/reactivity';
import { onMount } from './svelte-runtime.js';
import { get } from 'svelte/store';
import { _, locale } from 'svelte-i18n';
import { createFetchHost } from '@panomc/plugin-kit/controller';
import * as registry from '@panomc/sdk/core/js/ControllerRegistry.js';
import { getConfig, resolveUrl } from './config.js';
import { hostRequest } from './api.js';
import { getSession, onSession } from './session.js';
import { goto } from './svelte.js';
import { showToast } from './toasts.js';

export { registry };

// ---------------------------------------------------------------------------------------------
// Load memo: `load(name, params)` is shared while in flight and for 5 seconds afterwards, so four widgets of one
// plugin that all read the same controller make one request (doc 06 section 3.1).
// ---------------------------------------------------------------------------------------------

export const LOAD_MEMO_MS = 5000;

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

/**
 * @param {{ ttl?: number, now?: () => number }} [options]
 */
export function createLoadMemo({ ttl = LOAD_MEMO_MS, now = () => Date.now() } = {}) {
  /** @type {Map<string, { promise: Promise<any>, pending: boolean, settledAt: number }>} */
  const entries = new Map();

  return {
    /**
     * @param {string} name full controller name
     * @param {object | undefined} params
     * @param {() => Promise<any>} produce called only when nothing fresh is stored
     */
    run(name, params, produce) {
      const key = `${name}\u0000${stable(params ?? {})}`;
      const found = entries.get(key);

      if (found && (found.pending || now() - found.settledAt < ttl)) return found.promise;
      entries.delete(key);

      let promise;
      try {
        promise = Promise.resolve(produce());
      } catch (e) {
        promise = Promise.reject(e);
      }

      const entry = { promise, pending: true, settledAt: 0 };
      entries.set(key, entry);

      promise.then(
        (value) => {
          // a controller that is not available (null) may be registered a moment later: do not keep that answer
          if (value === null || value === undefined) {
            if (entries.get(key) === entry) entries.delete(key);
            return;
          }
          entry.pending = false;
          entry.settledAt = now();
        },
        () => {
          if (entries.get(key) === entry) entries.delete(key);
        },
      );

      return promise;
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}

const memo = createLoadMemo();

/** Forgets every memoised load (after `invalidate`, and in tests). */
export function clearLoadMemo() {
  memo.clear();
}

// ---------------------------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------------------------

function storage(kind) {
  try {
    return (kind === 'session' ? globalThis.sessionStorage : globalThis.localStorage) || null;
  } catch {
    return null;
  }
}

function currentLocale() {
  try {
    return get(locale) || getConfig().locale || undefined;
  } catch {
    return getConfig().locale || undefined;
  }
}

function translateKey(key, values) {
  try {
    return get(_)(key, { values });
  } catch {
    return key;
  }
}

/** A key of the URL map when the page configured it, else the default path on the site. */
function siteUrlFor(key, fallbackPath) {
  return getConfig().urls[key] ? resolveUrl(key) : resolveUrl(fallbackPath);
}

function withReturn(target, returnTo) {
  if (!returnTo) return target;
  return `${target}${target.includes('?') ? '&' : '?'}redirect=${encodeURIComponent(returnTo)}`;
}

/**
 * The `ControllerHost` of a widget page (doc 02 section 1): `request` goes to the page client, `session` / `onSession` to the
 * probe, `locale` / `t` to svelte-i18n, `toast` / `navigate` to the modules of this package, `storage` to the browser.
 * @param {Record<string, any>} [overrides]
 */
export function createWidgetHost(overrides = {}) {
  const base = createFetchHost({ baseUrl: getConfig().apiBase, browser: true });

  const host = {
    ...base,
    request: (r) => hostRequest(r),
    session: () => getSession(),
    onSession: (fn) => onSession(fn),
    locale: currentLocale,
    t: translateKey,
    toast: (key, o) => {
      void showToast(key, o?.values ?? {}, undefined, o?.variant ? { variant: o.variant } : undefined);
    },
    navigate: (url, o) => {
      void goto(url, { replaceState: !!o?.replace });
    },
    storage,
    feature: () => false,
    loginUrl: (returnTo) => withReturn(siteUrlFor('auth.login', '/login'), returnTo),
    registerUrl: (returnTo) => withReturn(siteUrlFor('auth.register', '/register'), returnTo),
    ...overrides,
  };

  Object.defineProperty(host, 'baseUrl', { get: () => getConfig().apiBase, enumerable: true, configurable: true });
  return host;
}

let hostInstalled = false;

/** Gives the registry its host factory (once per page). */
export function ensureControllerHost() {
  if (hostInstalled) return;
  hostInstalled = true;
  const host = createWidgetHost();
  registry.setHostFactory(() => host);
}

/** @type {Map<string, Promise<boolean>>} */
const pluginLoads = new Map();

/**
 * Registers a plugin's controllers before its first widget mounts: imports `controllers/controllers.mjs` (`url`, or an already
 * imported `module`) and registers its definitions. Once per plugin; resolves false when the plugin has none or the import fails.
 * @param {{ pluginId: string, ns: string, url?: string, module?: { controllers?: object } }} plugin
 */
export function loadPluginControllers({ pluginId, ns, url, module }) {
  if (!pluginLoads.has(pluginId)) {
    pluginLoads.set(
      pluginId,
      (async () => {
        try {
          const mod = module ?? (await import(/* @vite-ignore */ url));
          if (!mod?.controllers) return false;
          ensureControllerHost();
          registry.register(pluginId, ns, mod.controllers);
          return true;
        } catch (e) {
          console.warn(`[pano-widgets] controllers of ${pluginId} could not be loaded`, e);
          return false;
        }
      })(),
    );
  }
  return pluginLoads.get(pluginId);
}

// ---------------------------------------------------------------------------------------------
// The Svelte wrapper (same surface as packages/sdk/src/controllers.js)
// ---------------------------------------------------------------------------------------------

/**
 * Wraps a controller so `.state` is a tracked getter: reading it inside an effect or a template re-runs on change.
 * @param {{ get: () => any, subscribe: (run: (s:any) => void) => (() => void), actions: any }} controller
 */
export function reactive(controller) {
  const track = createSubscriber((update) => {
    let ready = false;
    // subscribe() calls back synchronously once with the current state; that is not a change
    const unsubscribe = controller.subscribe(() => {
      if (ready) update();
    });
    ready = true;
    return unsubscribe;
  });

  return {
    controller,
    actions: controller.actions,
    get state() {
      track();
      return controller.get();
    },
  };
}

/**
 * Registry `use` plus `reactive`; null when the controller is unavailable. An `instance` scoped controller is destroyed when the
 * calling component unmounts.
 * @param {string} name `<namespace>/<controller>`
 * @param {{version?:number, params?:object, initial?:object, event?:any}} [opts]
 */
export function useController(name, opts) {
  ensureControllerHost();
  const controller = registry.use(name, opts);
  if (!controller) return null;

  const isInstance = registry.list().find((c) => c.name === name)?.scope === 'instance';

  if (isInstance && typeof window !== 'undefined') {
    try {
      onMount(() => () => controller.destroy());
    } catch {
      // called outside a component: the caller owns destroy()
    }
  }

  return reactive(controller);
}

// `values` object (doc 02) or a svelte-i18n options object ({ values, default, ... }) are both accepted
function toI18nOptions(arg) {
  if (!arg || typeof arg !== 'object') return undefined;
  if ('values' in arg || 'default' in arg || 'locale' in arg || 'format' in arg) return arg;
  return { values: arg };
}

/** @param {string} namespace */
export function plugin(namespace) {
  const pluginId = () => registry.pluginIdOf(namespace) ?? `pano-plugin-${namespace}`;
  const prefix = () => `plugins.${pluginId()}.`;
  const fullName = (name) => `${namespace}/${name}`;

  /** readable store of `(key, values) => string` */
  const text = {
    subscribe(run) {
      const p = prefix();
      return _.subscribe(($fn) => {
        run((key, values) => $fn(`${p}${key}`, toI18nOptions(values)));
      });
    },
  };

  return {
    get id() {
      return pluginId();
    },
    namespace,
    get installed() {
      return registry.pluginIdOf(namespace) !== undefined;
    },
    _: text,
    toast(key, o) {
      return showToast(`${prefix()}${key}`, o?.values ?? {}, undefined, o?.variant ? { variant: o.variant } : undefined);
    },
    use(name, opts) {
      return useController(fullName(name), opts);
    },
    require(name, opts) {
      const c = useController(fullName(name), opts);
      if (!c) throw new Error(`${fullName(name)} is not available`);
      return c;
    },
    /** Memoised per page: shared while in flight and for 5 s (`LOAD_MEMO_MS`). */
    load(name, opts) {
      ensureControllerHost();
      const full = fullName(name);
      return memo.run(full, opts?.params, () => registry.load(full, opts));
    },
  };
}
