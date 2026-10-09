// Controller core of @panomc/plugin-kit (doc 02 section 1).
//
// This file has NO module imports on purpose: the build copies it verbatim into the plugin's
// self-contained controllers/controllers.mjs, and it must run in any page, Worker or runtime.
// It must also stay free of framework code. Everything here is plain JavaScript over the Svelte
// store contract (get + subscribe), so a Svelte `$cart` works with no wrapper.

/**
 * Header that carries the CSRF token on every mutation. This is a DUPLICATE of CSRF_HEADER in
 * packages/sdk/core/js/variables.js (this file imports nothing); a kit test asserts they are equal.
 */
export const CSRF_HEADER_NAME = 'X-CSRF-Token';

/** `/plugins/<id>/...` or `/api/plugins/<id>/...`, but not core's `/plugins/<id>/_/...` (decision 81). */
const PLUGIN_OWN_PATH = /^\/(?:api\/)?plugins\/[^/?#]+\/(?!_(?:[/?#]|$))[^?#]/;

/**
 * @typedef {Object} ControllerHost
 * @property {string} baseUrl
 * @property {boolean} browser
 * @property {(r:{method?:string, path:string, query?:object, body?:any, headers?:object, blob?:boolean}) => Promise<any>} request
 *   Parsed body in doc 04's shape (non-2xx = { error: { code, ... } }). `path` is what follows "/api/v1".
 *   A network failure resolves { error: { code: 'NETWORK_ERROR' } }; request never rejects.
 * @property {() => {user:(object|null), csrfToken:(string|null)}} session
 * @property {() => (string|undefined)} locale
 * @property {(fn:(s:any)=>void) => (() => void)} onSession   first bind, login, logout; a no-op on the server
 * @property {(key:string, values?:object) => string} t        full key: "plugins.pano-plugin-market.x"
 * @property {(key:string, o?:{variant?:'success'|'danger'|'warning', values?:object}) => void} toast
 * @property {(kind:'local'|'session') => (Storage|null)} storage
 * @property {() => number} now
 * @property {(url:string, o?:{replace?:boolean}) => void} navigate
 * @property {(name:string) => boolean} feature
 * @property {(returnTo?:string) => string} loginUrl
 * @property {(returnTo?:string) => string} registerUrl
 */

/**
 * @template S
 * @typedef {Object} Store
 * @property {() => S} get
 * @property {(run:(s:S)=>void) => (() => void)} subscribe   calls run synchronously once, then on every change
 */

/**
 * @template S
 * @typedef {Store<S> & {set:(s:S)=>void, update:(f:(s:S)=>S)=>void}} State
 */

/**
 * @template S, A
 * @typedef {Object} Ctx
 * @property {ControllerHost} host
 * @property {object} params
 * @property {() => S} get
 * @property {(s:S) => void} set
 * @property {(f:(s:S)=>S) => void} update
 * @property {(name:string) => Controller<any, any>} use   a sibling controller of the same plugin, same host
 */

/**
 * What a theme, a web component or plain JS holds. `name` is "market/cart" (namespace + "/" + spec.name).
 * `get()` is a snapshot, replaced on change and never mutated.
 * @template S, A
 * @typedef {Object} Controller
 * @property {string} name
 * @property {number} version
 * @property {() => S} get
 * @property {(run:(s:S)=>void) => (() => void)} subscribe
 * @property {A} actions
 * @property {() => void} destroy
 */

/**
 * @template S, A
 * @typedef {Object} ControllerSpec
 * @property {string} name                 camelCase, unique in the plugin: "cart"
 * @property {number} version              contract version, integer >= 1
 * @property {'app'|'instance'} [scope]    'app' (default) one per page; 'instance' one per use()
 * @property {boolean} [eager]             app scope: created and started right after register() in the browser
 * @property {(c:{host:ControllerHost, params:object}) => S} [state]   initial state holding EVERY public key; accepts params {}
 * @property {(c:Ctx<S,A>) => A} [actions]   plain functions; default () => ({})
 * @property {(c:Ctx<S,A> & {actions:A}) => (void|(() => void))} [start]   browser only. Runs on the first subscriber
 *           (eager: at creation); the returned function runs after the last subscriber leaves (eager: on destroy)
 * @property {(c:{host:ControllerHost, params:object}) => Promise<object>} [load]   SSR-safe page loader, no instance state
 */

/**
 * What defineController returns.
 * @template S, A
 * @typedef {Object} ControllerDefinition
 * @property {string} name
 * @property {number} version
 * @property {'app'|'instance'} scope
 * @property {boolean} eager
 * @property {ControllerSpec<S,A>} spec
 * @property {((c:{host:ControllerHost, params:object}) => Promise<object>)|undefined} load
 * @property {(host:ControllerHost, params?:object, initial?:object, opts?:{namespace?:string, use?:(name:string)=>Controller<any,any>}) => Controller<S,A>} create
 *   `initial` is a patch merged over the initial state. opts.namespace gives the controller its full name,
 *   opts.use resolves siblings for ctx.use (the registry passes both).
 */

const NOOP = () => {};
const NAME_RE = /^[a-z][A-Za-z0-9]*$/;

/** Makes an unsubscribe function that only does its work once. */
function once(fn) {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    fn();
  };
}

/**
 * A tiny store. `set` notifies only when `!Object.is(prev, next)`, synchronously and in order (a set
 * made inside a subscriber is queued behind the notification that is running).
 * @template S
 * @param {S} initial
 * @returns {State<S>}
 */
export function createState(initial) {
  let value = initial;
  const subscribers = new Set();
  const pending = [];
  let flushing = false;

  function flush() {
    flushing = true;
    try {
      while (pending.length) {
        const next = pending.shift();
        for (const run of [...subscribers]) {
          if (subscribers.has(run)) run(next);
        }
      }
    } finally {
      pending.length = 0;
      flushing = false;
    }
  }

  function set(next) {
    if (Object.is(value, next)) return;
    value = next;
    pending.push(next);
    if (!flushing) flush();
  }

  return {
    get: () => value,
    set,
    update: (f) => set(f(value)),
    subscribe(run) {
      // A fresh wrapper per subscription, so the same function may subscribe twice.
      const entry = (s) => run(s);
      subscribers.add(entry);
      run(value);
      return once(() => {
        subscribers.delete(entry);
      });
    },
  };
}

/**
 * A store computed from one store (fn receives its value) or an array of stores (fn receives an array of
 * values). Subscribes to the sources on the first subscriber and lets go after the last. Without
 * subscribers `get()` recomputes only when a source value changed.
 * @param {Store<any> | Store<any>[]} sources
 * @param {(v:any) => any} fn
 * @returns {Store<any>}
 */
export function derive(sources, fn) {
  const multi = Array.isArray(sources);
  const list = multi ? sources : [sources];
  const inner = createState(undefined);
  let subscribers = 0;
  let unsubs = [];
  let lastInputs = null;
  let lastOutput;

  function compute() {
    const inputs = list.map((s) => s.get());
    if (lastInputs && inputs.every((v, i) => Object.is(v, lastInputs[i]))) return lastOutput;
    lastInputs = inputs;
    lastOutput = fn(multi ? inputs : inputs[0]);
    return lastOutput;
  }

  return {
    get: () => (subscribers > 0 ? inner.get() : compute()),
    subscribe(run) {
      if (subscribers === 0) {
        let initializing = true;
        unsubs = list.map((s) =>
          s.subscribe(() => {
            if (!initializing) inner.set(compute());
          }),
        );
        initializing = false;
        inner.set(compute());
      }
      subscribers++;
      const off = inner.subscribe(run);
      return once(() => {
        off();
        subscribers--;
        if (subscribers === 0) {
          for (const u of unsubs) u();
          unsubs = [];
        }
      });
    },
  };
}

/**
 * Declares a controller. Nothing is created until `create(host, params, initial, opts)` is called.
 * @template S, A
 * @param {ControllerSpec<S,A>} spec
 * @returns {ControllerDefinition<S,A>}
 */
export function defineController(spec) {
  if (!spec || typeof spec !== 'object') throw new TypeError('defineController: a spec object is required');
  if (typeof spec.name !== 'string' || !NAME_RE.test(spec.name)) {
    throw new TypeError(`defineController: name must be camelCase, got ${JSON.stringify(spec.name)}`);
  }
  if (!Number.isInteger(spec.version) || spec.version < 1) {
    throw new TypeError(`defineController(${spec.name}): version must be an integer >= 1`);
  }
  const scope = spec.scope ?? 'app';
  if (scope !== 'app' && scope !== 'instance') {
    throw new TypeError(`defineController(${spec.name}): scope must be 'app' or 'instance'`);
  }
  for (const key of ['state', 'actions', 'start', 'load']) {
    if (spec[key] != null && typeof spec[key] !== 'function') {
      throw new TypeError(`defineController(${spec.name}): ${key} must be a function`);
    }
  }

  const definition = {
    name: spec.name,
    version: spec.version,
    scope,
    eager: spec.eager === true,
    spec,
    create(host, params, initial, opts) {
      return createController(definition, host, params, initial, opts);
    },
  };
  definition.load = spec.load || undefined;
  return definition;
}

function createController(def, host, params, initial, opts) {
  const spec = def.spec;
  const theHost = host || nullHost;
  const theParams = params || {};
  const fullName = opts && opts.namespace ? `${opts.namespace}/${def.name}` : def.name;

  let first = spec.state ? spec.state({ host: theHost, params: theParams }) : {};
  if (initial && typeof initial === 'object') first = { ...first, ...initial };
  const store = createState(first);

  const ctx = {
    host: theHost,
    params: theParams,
    get: store.get,
    set: store.set,
    update: store.update,
    use(name) {
      if (opts && typeof opts.use === 'function') return opts.use(name);
      throw new Error(`ctx.use('${name}'): this controller was created outside a registry`);
    },
  };

  const actions = spec.actions ? spec.actions(ctx) || {} : {};
  const startCtx = { ...ctx, actions };

  let destroyed = false;
  let running = false;
  let cleanup = null;
  let count = 0;
  const live = new Set();
  const canStart = () => !destroyed && !!spec.start && theHost.browser === true;

  function startNow() {
    if (running || !canStart()) return;
    running = true;
    try {
      const stop = spec.start(startCtx);
      cleanup = typeof stop === 'function' ? stop : null;
    } catch (e) {
      console.error(`[pano] controller '${fullName}' start failed`, e);
    }
  }

  function stopNow() {
    if (!running) return;
    running = false;
    const stop = cleanup;
    cleanup = null;
    if (stop) {
      try {
        stop();
      } catch (e) {
        console.error(`[pano] controller '${fullName}' stop failed`, e);
      }
    }
  }

  const controller = {
    name: fullName,
    version: def.version,
    get: store.get,
    actions,
    subscribe(run) {
      // Start BEFORE the subscriber joins: whatever start sets synchronously is already in the first value.
      if (count === 0 && !def.eager) startNow();
      count++;
      const off = store.subscribe(run);
      const done = once(() => {
        off();
        live.delete(done);
        count--;
        if (count === 0 && !def.eager) stopNow();
      });
      live.add(done);
      return done;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const off of [...live]) off();
      stopNow();
    },
  };

  if (def.eager) startNow();
  return controller;
}

// ---------------------------------------------------------------------------------------------
// Hosts
// ---------------------------------------------------------------------------------------------

const GUEST_SESSION = Object.freeze({ user: null, csrfToken: null });

/** Guest session, `request` resolves NULL_HOST, everything else is a safe no-op. */
export const nullHost = Object.freeze({
  baseUrl: '',
  browser: false,
  request: () => Promise.resolve({ error: { code: 'NULL_HOST' } }),
  session: () => GUEST_SESSION,
  locale: () => undefined,
  onSession: () => NOOP,
  t: (key) => key,
  toast: NOOP,
  storage: () => null,
  now: () => Date.now(),
  navigate: NOOP,
  feature: () => false,
  loginUrl: () => '/login',
  registerUrl: () => '/register',
});

function interpolate(text, values) {
  if (!values) return text;
  return text.replace(/\{\s*([\w.-]+)\s*\}/g, (m, k) => (k in values && values[k] != null ? String(values[k]) : m));
}

function withReturn(base, returnTo) {
  return returnTo ? `${base}?redirect=${encodeURIComponent(returnTo)}` : base;
}

function buildQueryString(query) {
  if (!query || typeof query !== 'object') return '';
  const parts = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) if (v !== undefined && v !== null) parts.append(key, String(v));
    } else {
      parts.append(key, String(value));
    }
  }
  const text = parts.toString();
  return text ? `?${text}` : '';
}

function isRawBody(body) {
  return (
    typeof body === 'string' ||
    (typeof FormData !== 'undefined' && body instanceof FormData) ||
    (typeof Blob !== 'undefined' && body instanceof Blob) ||
    (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) ||
    (typeof ArrayBuffer !== 'undefined' && (body instanceof ArrayBuffer || ArrayBuffer.isView(body)))
  );
}

const networkError = () => ({ error: { code: 'NETWORK_ERROR' } });

/**
 * A host over `fetch`, for web components, the starter and non-Svelte front-ends.
 * `baseUrl` is what precedes "/api/v1" (Pano's origin, or a proxy prefix such as "/pano"); request paths
 * are the part after "/api/v1". `getToken` sends `Authorization: Bearer`, else cookies (`credentials: 'include'`).
 * `locale` may be a string or a function; `messages` is a flat map of full key to text; `features` is an
 * array, a Set, an object map or a function; `storage` is a function (kind) or `{ local, session }`.
 * Extras beyond doc 02: `browser`, `now`, `getSession` (returns { user }), `onSession` (subscribe function).
 * `onToast(key, { variant, values, message })` receives the translated text as `message`.
 * @param {{baseUrl:string, fetch?:Function, getToken?:()=>(string|null|undefined), getCsrf?:()=>(string|null|undefined),
 *   locale?:(string|(()=>string|undefined)), messages?:Record<string,string>,
 *   features?:(string[]|Set<string>|Record<string,boolean>|((name:string)=>boolean)),
 *   loginUrl?:(returnTo?:string)=>string, registerUrl?:(returnTo?:string)=>string,
 *   onToast?:(key:string, o:object)=>void, onNavigate?:(url:string, o?:{replace?:boolean})=>void,
 *   storage?:(((kind:'local'|'session')=>Storage|null)|{local?:Storage, session?:Storage}),
 *   browser?:boolean, now?:()=>number, getSession?:()=>({user?:object|null}|null|undefined),
 *   onSession?:(fn:(s:any)=>void)=>(()=>void)}} options
 * @returns {ControllerHost}
 */
export function createFetchHost(options = {}) {
  const o = options || {};
  const baseUrl = String(o.baseUrl ?? '').replace(/\/+$/, '');
  const browser = typeof o.browser === 'boolean' ? o.browser : typeof window !== 'undefined';
  const doFetch = (...args) => (o.fetch || globalThis.fetch)(...args);

  const t = (key, values) => {
    const text = o.messages && typeof o.messages[key] === 'string' ? o.messages[key] : key;
    return interpolate(text, values);
  };

  async function request(r) {
    try {
      const { method = 'GET', path = '', query, body, headers, blob } = r || {};
      const verb = String(method).toUpperCase();
      const rooted = path.startsWith('/') || path === '' ? path : `/${path}`;
      // A plugin's own endpoints are unversioned (decision 81): `/plugins/<id>/...` goes to `/api/plugins/<id>/...`.
      const root = PLUGIN_OWN_PATH.test(rooted) ? '/api' : '/api/v1';
      const url = `${baseUrl}${root}${rooted.replace(/^\/api(?=\/plugins\/)/, '')}${buildQueryString(query)}`;

      const sent = { Accept: 'application/json' };
      const init = { method: verb, headers: sent };
      const token = o.getToken ? o.getToken() : null;
      if (token) sent.Authorization = `Bearer ${token}`;
      else init.credentials = 'include';

      const csrf = o.getCsrf ? o.getCsrf() : null;
      if (csrf && verb !== 'GET' && verb !== 'HEAD') sent[CSRF_HEADER_NAME] = csrf;

      if (body !== undefined && body !== null && verb !== 'GET' && verb !== 'HEAD') {
        if (isRawBody(body)) {
          init.body = body;
        } else {
          sent['Content-Type'] = 'application/json';
          init.body = JSON.stringify(body);
        }
      }
      if (headers) Object.assign(sent, headers);

      const res = await doFetch(url, init);

      if (blob && res.ok) return await res.blob();

      const text = await res.text();
      let parsed;
      let parseFailed = false;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch (e) {
          parseFailed = true;
        }
      }

      if (res.ok) {
        if (!text) return {};
        return parseFailed ? { error: { code: 'INVALID_RESPONSE' } } : parsed;
      }
      if (!parseFailed && parsed && typeof parsed === 'object' && parsed.error) return parsed;
      return { error: { code: 'UNKNOWN_ERROR', details: { status: res.status } } };
    } catch (e) {
      return networkError();
    }
  }

  const hasFeature = (name) => {
    const f = o.features;
    if (!f) return false;
    if (typeof f === 'function') return !!f(name);
    if (Array.isArray(f)) return f.includes(name);
    if (typeof f.has === 'function') return !!f.has(name);
    return f[name] === true;
  };

  function storage(kind) {
    try {
      if (typeof o.storage === 'function') return o.storage(kind) || null;
      if (o.storage && typeof o.storage === 'object') return o.storage[kind] || null;
      if (!browser) return null;
      return (kind === 'session' ? globalThis.sessionStorage : globalThis.localStorage) || null;
    } catch (e) {
      return null;
    }
  }

  return {
    baseUrl,
    browser,
    request,
    session() {
      let user = null;
      try {
        user = (o.getSession && o.getSession()?.user) || null;
      } catch (e) {
        user = null;
      }
      return { user, csrfToken: (o.getCsrf && o.getCsrf()) || null };
    },
    locale: () => (typeof o.locale === 'function' ? o.locale() : o.locale),
    onSession: (fn) => (typeof o.onSession === 'function' ? o.onSession(fn) || NOOP : NOOP),
    t,
    toast(key, opts) {
      if (!o.onToast) return;
      const values = opts && opts.values;
      o.onToast(key, { ...(opts || {}), message: t(key, values) });
    },
    storage,
    now: () => (o.now ? o.now() : Date.now()),
    navigate(url, opts) {
      if (o.onNavigate) return o.onNavigate(url, opts);
      if (!browser || typeof location === 'undefined') return;
      if (opts && opts.replace) location.replace(url);
      else location.assign(url);
    },
    feature: hasFeature,
    loginUrl: (returnTo) => (o.loginUrl ? o.loginUrl(returnTo) : withReturn('/login', returnTo)),
    registerUrl: (returnTo) => (o.registerUrl ? o.registerUrl(returnTo) : withReturn('/register', returnTo)),
  };
}

// ---------------------------------------------------------------------------------------------
// Sample controller (view catalogue, doc 02 section 7)
// ---------------------------------------------------------------------------------------------

/**
 * A controller with a FIXED state: the definition's initial state (built on `nullHost`, empty params)
 * with `patch` merged over it. Its actions have the names of the real ones but only record
 * `{ name, args }` into `controller.calls` and resolve `{ ok: true }`; nothing else runs and nothing
 * touches the registry cache. `start` never runs.
 * @param {ControllerDefinition<any,any>} def
 * @param {object} [patch]
 * @param {{namespace?:string, use?:(name:string)=>Controller<any,any>, onCall?:(call:{name:string,args:any[]})=>void}} [opts]
 * @returns {Controller<any,any> & {calls:{name:string,args:any[]}[]}}
 */
export function createSampleController(def, patch, opts) {
  const spec = def.spec || {};
  const o = opts || {};
  let first = spec.state ? spec.state({ host: nullHost, params: {} }) : {};
  if (patch && typeof patch === 'object') first = { ...first, ...patch };
  const store = createState(first);
  const calls = [];

  // Learn the action names from the real factory on a sandbox ctx whose writes go nowhere.
  let names = [];
  if (spec.actions) {
    try {
      const real = spec.actions({
        host: nullHost,
        params: {},
        get: store.get,
        set: NOOP,
        update: NOOP,
        use: (name) => {
          if (typeof o.use === 'function') return o.use(name);
          return { name, version: 0, get: () => ({}), subscribe: (run) => (run({}), NOOP), actions: {}, destroy: NOOP };
        },
      });
      names = Object.keys(real || {});
    } catch (e) {
      names = [];
    }
  }

  const actions = {};
  for (const name of names) {
    actions[name] = (...args) => {
      const call = { name, args };
      calls.push(call);
      if (o.onCall) o.onCall(call);
      return Promise.resolve({ ok: true });
    };
  }

  return {
    name: o.namespace ? `${o.namespace}/${def.name}` : def.name,
    version: def.version,
    get: store.get,
    subscribe: store.subscribe,
    actions,
    calls,
    destroy: NOOP,
  };
}
