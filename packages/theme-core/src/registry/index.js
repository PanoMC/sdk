/**
 * Theme config + view registry (doc 01 §4): one resolution rule for engine
 * views and plugin views.
 *
 * A theme declares overrides in its theme.config.js (`views`); the generated
 * root layout shim calls setThemeConfig() as a module side effect, so the
 * registry is populated on the server and the client. Resolution waits for it
 * because page and layout loads run in parallel.
 *
 * Core code never imports a theme's view directly. It resolves through
 * resolveView(name, defaultThunk) / loadView(event, name, defaultThunk):
 *
 *   1. `def` is the registered default (registerEngineViews / registerViews);
 *      a passed `defaultThunk` wins as the thunk, so the ~40 old callers keep
 *      working. No `def` -> null (the plugin is not installed).
 *   2. `ov` = themeConfig.views[name]: a function -> { contract: 1, component },
 *      an object -> as is.
 *   3. No `ov` -> the default. `ov.contract !== def.contract` -> the default and
 *      issue CONTRACT_MISMATCH. A controller named in `ov.controllers` whose theme
 *      pin differs from the registered controller version -> the default and
 *      issue CONTROLLER_MISMATCH. An override that fails to import -> the default
 *      and issue LOAD_FAILED.
 *   4. Data always comes from the default: module = { ...defaultModule,
 *      default: Override ?? Default }. A `load` exported by an override is ignored.
 *   5. Cached per name (not in dev). resetPluginViews() clears plugin entries.
 *
 * Plugin views are ids `<ns>:<Name>`; `<pluginId>:<Name>` is always accepted as
 * an alias. Engine views keep bare names.
 */

import { dev } from "$app/environment";
import { blockKey } from "./view.js";

// `route()` (doc 01 section 9) is part of this module's public surface, so themes and plugins
// import it from `$pano/registry/index.js`; the implementation is `./routes.js`.
export { route } from "./routes.js";

// ---------------------------------------------------------------------------
// Theme config
// ---------------------------------------------------------------------------

let themeConfig = {};

// SvelteKit runs the root layout and page loads in parallel, so a page load can
// call resolveView() before the root layout module (which calls setThemeConfig)
// finished evaluating. Resolution waits for this promise instead of reading an
// empty config. Safety valve: a theme that never registers gets the core
// defaults after READY_TIMEOUT_MS rather than a hung page.
const READY_TIMEOUT_MS = 5000;
let configured = false;
let markReady;
let ready;

function newReady() {
  ready = new Promise((resolve) => {
    markReady = resolve;
  });
}
newReady();

export function setThemeConfig(config) {
  themeConfig = config ?? {};
  configured = true;
  derived.config = null;
  clearResolution();
  markReady();
}

async function waitForThemeConfig() {
  if (configured) return;
  let timer;
  await Promise.race([
    ready,
    new Promise((resolve) => {
      timer = setTimeout(resolve, READY_TIMEOUT_MS);
    }),
  ]);
  clearTimeout(timer);
}

export function getThemeConfig() {
  return themeConfig;
}

/** Theme-declared extensions to the theme-settings schema (P2). */
export function getSettingsSchemaExtension() {
  return themeConfig.settingsSchema ?? null;
}

/**
 * Does the theme ship Bootstrap / Font Awesome itself? false only for an exact
 * `false` (doc 03 §4.1).
 * @returns {{ bootstrap: boolean, fontawesome: boolean }}
 */
export function getThemeProvides() {
  const provides = themeConfig.provides ?? {};
  return {
    bootstrap: provides.bootstrap !== false,
    fontawesome: provides.fontawesome !== false,
  };
}

// ---------------------------------------------------------------------------
// Theme meta (virtual:pano-theme-meta, doc 01 §4)
// ---------------------------------------------------------------------------

/**
 * @typedef {{ id: string, props?: Record<string, string|number|boolean> }} Ref
 * @typedef {{ refs?: Record<string, Ref[]>, claims?: string[], homePages?: Record<string, () => Promise<any>> }} ThemeMeta
 */

/** @type {ThemeMeta} */
let themeMeta = { refs: {}, claims: [], homePages: {} };

/** @param {ThemeMeta | null | undefined} meta */
export function setThemeMeta(meta) {
  themeMeta = {
    refs: meta?.refs ?? {},
    claims: meta?.claims ?? [],
    homePages: meta?.homePages ?? {},
  };
  derived.refs = null;
  derived.claims = null;
}

export function getThemeMeta() {
  return themeMeta;
}

// ---------------------------------------------------------------------------
// Registered defaults
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   name?: string, pluginId?: string, ns?: string, contract?: number,
 *   kind?: "page"|"component"|"layout", component: () => Promise<any>,
 *   uses?: string[], slots?: string[], hooks?: string[], block?: boolean,
 *   inject?: object[]|null, page?: object|null, home?: object|null,
 * }} ViewDef
 */

/** @type {Map<string, ViewDef>} bare engine names */
const engineViews = new Map();
/** @type {Map<string, ViewDef>} `<ns>:<Name>` */
const pluginViews = new Map();
/** @type {Map<string, string>} ns -> pluginId that owns it (the namespace guard) */
const nsOwners = new Map();
/** @type {Map<string, string>} pluginId -> ns (the alias table) */
const pluginToNs = new Map();

// Bumped whenever the alias table changes; derived maps depend on it.
let aliasVersion = 0;

/** Memoised maps computed from themeConfig / themeMeta / the alias table. */
const derived = {
  /** @type {null | { v: number, map: Map<string, any> }} */
  config: null,
  /** @type {null | { v: number, map: Map<string, Ref[]> }} */
  refs: null,
  /** @type {null | { v: number, set: Set<string> }} */
  claims: null,
};

/**
 * `<pluginId>:<Name>` -> `<ns>:<Name>`. Anything else is returned unchanged.
 * A prefix that is itself a registered namespace wins over an alias.
 * @param {string} name
 */
function canonical(name) {
  if (typeof name !== "string") return name;
  const at = name.indexOf(":");
  if (at <= 0) return name;
  const prefix = name.slice(0, at);
  if (nsOwners.has(prefix)) return name;
  const ns = pluginToNs.get(prefix);
  return ns ? ns + name.slice(at) : name;
}

/** @param {string} id */
function lookupDef(id) {
  return pluginViews.get(id) ?? engineViews.get(id) ?? null;
}

/**
 * Generated table of the engine's own views: `{ [name]: { contract, component } }`.
 * @param {Record<string, { contract?: number, component: () => Promise<any>, uses?: string[], slots?: string[], hooks?: string[] }>} table
 */
export function registerEngineViews(table) {
  for (const [name, entry] of Object.entries(table ?? {})) {
    engineViews.set(name, { ...entry, name, contract: entry.contract ?? 1 });
    dropResolution(name);
  }
}

/**
 * From `pano.views.add` (doc 01 §3). A def whose namespace is owned by another
 * pluginId is rejected with console.error (the clash guard of doc 01 §1).
 * @param {ViewDef[]} defs
 */
export function registerViews(defs) {
  for (const def of defs ?? []) {
    const name = def?.name;
    const at = typeof name === "string" ? name.indexOf(":") : -1;
    if (at <= 0 || typeof def.component !== "function") {
      console.error(
        `[theme-core] registerViews: '${name}' is not a plugin view id (<ns>:<Name>) with a component; ignored`,
      );
      continue;
    }
    const ns = name.slice(0, at);
    if (def.ns && def.ns !== ns) {
      console.error(
        `[theme-core] registerViews: '${name}' declares namespace '${def.ns}'; ignored`,
      );
      continue;
    }
    const owner = nsOwners.get(ns);
    if (owner && owner !== def.pluginId) {
      console.error(
        `[theme-core] registerViews: namespace '${ns}' is owned by '${owner}', '${name}' of '${def.pluginId}' is rejected (NAMESPACE_CLASH)`,
      );
      continue;
    }
    if (!owner) {
      nsOwners.set(ns, def.pluginId);
      aliasVersion++;
    }
    if (def.pluginId && pluginToNs.get(def.pluginId) !== ns) {
      pluginToNs.set(def.pluginId, ns);
      aliasVersion++;
    }
    pluginViews.set(name, { ...def, ns, contract: def.contract ?? 1 });
    dropResolution(name);
  }
}

/** Called by the plugin API's init(): forget every plugin view and namespace. */
export function resetPluginViews() {
  const ids = [...pluginViews.keys()];
  pluginViews.clear();
  nsOwners.clear();
  pluginToNs.clear();
  aliasVersion++;
  for (const id of ids) dropResolution(id);
  const gone = new Set(ids);
  for (const [key, issue] of [...issues]) {
    if (gone.has(issue.view)) issues.delete(key);
  }
}

/** @param {string} name */
export function hasView(name) {
  return lookupDef(canonical(name)) !== null;
}

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

/**
 * `themeConfig.views` keyed by canonical id, every entry in the object form
 * `{ contract, controllers, component }` (a function is `{ contract: 1 }`; a bare
 * module object stays supported as the old "non-function override").
 */
function overrideMap() {
  if (derived.config && derived.config.v === aliasVersion) return derived.config.map;
  const map = new Map();
  const views = themeConfig.views ?? {};
  for (const key of Object.keys(views)) {
    const raw = views[key];
    if (!raw) continue;
    let entry;
    if (typeof raw === "function") entry = { contract: 1, component: raw };
    else if (typeof raw === "object" && typeof raw.component === "function")
      entry = { contract: raw.contract ?? 1, controllers: raw.controllers ?? [], component: raw.component };
    else entry = { contract: 1, component: () => raw };
    const id = canonical(key);
    // an exact-name key beats an alias spelling of the same view
    if (!map.has(id) || id === key) map.set(id, entry);
  }
  derived.config = { v: aliasVersion, map };
  return map;
}

/** @returns {Map<string, Ref[]>} override / "route:<path>" / "home:<id>" -> refs */
function refsMap() {
  if (derived.refs && derived.refs.v === aliasVersion) return derived.refs.map;
  const map = new Map();
  for (const [key, refs] of Object.entries(themeMeta.refs ?? {})) {
    const id = canonical(key);
    map.set(id, [...(map.get(id) ?? []), ...(refs ?? [])]);
  }
  derived.refs = { v: aliasVersion, map };
  return map;
}

/**
 * Ids the theme places itself, so the automatic copy must disappear (doc 01 §5):
 * the scan's literal ids plus `themeConfig.claims`; an explicit `false` wins.
 * @returns {Set<string>}
 */
export function getClaims() {
  if (derived.claims && derived.claims.v === aliasVersion) return derived.claims.set;
  const set = new Set();
  const add = (id) => {
    set.add(id);
    set.add(canonical(id));
  };
  for (const id of themeMeta.claims ?? []) add(id);
  for (const [id, value] of Object.entries(themeConfig.claims ?? {})) {
    if (value === false) {
      set.delete(id);
      set.delete(canonical(id));
    } else if (value) add(id);
  }
  derived.claims = { v: aliasVersion, set };
  return set;
}

// ---------------------------------------------------------------------------
// Controller versions (doc 02 §2) read through globalThis.__PANO_CONTROLLERS__
// ---------------------------------------------------------------------------

/**
 * The registered version of a controller, `undefined` when it is not
 * registered or the registry is absent. Tolerant about the registry's shape:
 * a `list()` result, or a Map / plain object of definitions.
 * @param {string} name
 * @returns {number | string | undefined}
 */
function registeredControllerVersion(name) {
  const state = globalThis.__PANO_CONTROLLERS__;
  if (!state) return undefined;
  try {
    if (typeof state.list === "function") {
      const hit = state.list().find((c) => c?.name === name);
      if (hit) return hit.version;
    }
    for (const holder of [state, state.definitions, state.defs, state.controllers, state.registry]) {
      if (!holder) continue;
      const entry = holder instanceof Map ? holder.get(name) : holder[name];
      if (entry && typeof entry === "object" && "version" in entry) return entry.version;
    }
  } catch {
    /* an unreadable registry means no opinion */
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

/** @type {Map<string, any>} */
const issues = new Map();

function report(issue, message) {
  const key = `${issue.type}:${issue.view}:${issue.controller ?? ""}`;
  if (issues.has(key)) return;
  issues.set(key, issue);
  if (dev) console.warn(`[theme-core] ${message}`);
}

/** @returns {Array<{ type: string, view: string, [k: string]: any }>} */
export function getIssues() {
  return [...issues.values()];
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** @type {Map<string, Promise<ResolvedView | null>>} */
const resolved = new Map();
/** Sync caches for proxies / PluginBlock: filled by every resolution. */
const overrideComponents = new Map();
const defaultComponents = new Map();
/** @type {Map<string, "default"|"override"|"fallback">} */
const statuses = new Map();

/** @typedef {{ module: any, source: "override"|"default", contract: number }} ResolvedView */

function dropResolution(id) {
  resolved.delete(id);
  overrideComponents.delete(id);
  defaultComponents.delete(id);
  statuses.delete(id);
}

function clearResolution() {
  resolved.clear();
  overrideComponents.clear();
  defaultComponents.clear();
  statuses.clear();
}

/**
 * @param {string} id  canonical
 * @param {(() => Promise<any>) | undefined} thunk
 * @returns {Promise<ResolvedView | null>}
 */
async function resolveNow(id, thunk) {
  const registered = lookupDef(id);
  /** @type {ViewDef | null} */
  const def =
    typeof thunk === "function"
      ? { ...registered, name: id, contract: registered?.contract ?? 1, component: thunk }
      : registered;
  if (!def) return null;

  const defaultModule = await def.component();
  const Default = defaultModule?.default ?? defaultModule;
  defaultComponents.set(id, Default);

  const ov = overrideMap().get(id);
  /** @type {any} */
  let Override = null;
  if (ov) {
    const where = def.pluginId ? { pluginId: def.pluginId } : {};
    const themeContract = ov.contract ?? 1;
    if (themeContract !== def.contract) {
      report(
        { type: "CONTRACT_MISMATCH", view: id, ...where, themeContract, currentContract: def.contract },
        `override of '${id}' was written for contract ${themeContract}, the view is at ${def.contract}; showing the default view`,
      );
    } else {
      let mismatch = null;
      for (const controller of ov.controllers ?? []) {
        const pin = themeConfig.controllers?.[controller];
        const current = registeredControllerVersion(controller);
        if (pin !== undefined && current !== undefined && pin !== current) {
          mismatch = { controller, themeVersion: pin, currentVersion: current };
          break;
        }
      }
      if (mismatch) {
        report(
          { type: "CONTROLLER_MISMATCH", view: id, ...where, ...mismatch },
          `override of '${id}' pins controller '${mismatch.controller}' at ${mismatch.themeVersion}, the plugin is at ${mismatch.currentVersion}; showing the default view`,
        );
      } else {
        try {
          const mod = await ov.component();
          Override = mod?.default ?? mod;
          if (!Override) throw new Error("the override module has no default export");
        } catch (e) {
          Override = null;
          console.error(
            `[theme-core] view override '${id}' failed to load; falling back to the default view`,
            e,
          );
          report(
            { type: "LOAD_FAILED", view: id, ...where, error: String(e?.message ?? e) },
            `override of '${id}' failed to load; showing the default view`,
          );
        }
      }
    }
  }

  overrideComponents.set(id, Override);
  statuses.set(id, Override ? "override" : ov ? "fallback" : "default");

  // Rule 4: data (`load`, controller load) is always the default module's.
  const module =
    defaultModule !== null && typeof defaultModule === "object"
      ? { ...defaultModule, default: Override ?? Default }
      : { default: Override ?? Default };

  return {
    module,
    source: Override ? "override" : "default",
    contract: Override ? (ov?.contract ?? 1) : def.contract,
  };
}

/**
 * @param {string} name  stable view id: "LoginView", "market:ProductCard" or "<pluginId>:ProductCard"
 * @param {() => Promise<any>} [defaultThunk]  the default view module thunk
 * @returns {Promise<ResolvedView | null>}  null = unknown name (plugin not installed)
 */
export async function resolveViewModule(name, defaultThunk) {
  await waitForThemeConfig();
  const id = canonical(name);

  // Never cache in dev: the cache would pin the module instance from the first
  // request, so view-file edits (and core fixes) would silently not apply until
  // a full dev-server restart. Vite already dedupes and HMR-invalidates import().
  if (!dev) {
    const cached = resolved.get(id);
    if (cached) return cached;
  }
  const pending = resolveNow(id, defaultThunk);
  if (!dev) {
    resolved.set(id, pending);
    pending.then(
      (result) => {
        if (!result && resolved.get(id) === pending) resolved.delete(id);
      },
      () => {
        if (resolved.get(id) === pending) resolved.delete(id);
      },
    );
  }
  return pending;
}

/**
 * @param {string} name  stable view id, e.g. "LoginView" — part of the theme contract
 * @param {() => Promise<any>} [defaultThunk]  core's default view module thunk
 * @returns {Promise<any>} the Svelte component to render (null for an unknown name)
 */
export async function resolveView(name, defaultThunk) {
  const result = await resolveViewModule(name, defaultThunk);
  return result ? result.module.default : null;
}

/** Loaded override component, sync. null = no (valid) override or not loaded yet. */
export function getOverride(name) {
  return overrideComponents.get(canonical(name)) ?? null;
}

/** Loaded default component, sync. null = not loaded yet or unknown. */
export function getDefault(name) {
  return defaultComponents.get(canonical(name)) ?? null;
}

/**
 * @param {string} name
 * @returns {{ contract: number, block: boolean, overridden: boolean, overrideContract: number|null, status: "default"|"override"|"fallback" } | null}
 */
export function describeView(name) {
  const id = canonical(name);
  const def = lookupDef(id);
  if (!def) return null;
  const ov = overrideMap().get(id);
  return {
    contract: def.contract ?? 1,
    block: Boolean(def.block),
    overridden: Boolean(ov),
    overrideContract: ov ? (ov.contract ?? 1) : null,
    status: statuses.get(id) ?? (ov ? "fallback" : "default"),
  };
}

// ---------------------------------------------------------------------------
// Closure: preload + block loads + slot loads
// ---------------------------------------------------------------------------

/** Plugin slot ids are `<ns>:<slot>`; engine ids keep today's bare names. */
const isPluginSlot = (id) => typeof id === "string" && id.includes(":");

/** `route:<path>` and `home:<id>` are meta keys, not views. */
const isMetaKey = (id) => /^(route|home):/.test(id);

/**
 * Resolves `rootName` and everything it renders: an overridden view -> the refs
 * the theme-meta scan found in it; a default view -> its `uses`.
 * @param {string} rootName
 * @param {(() => Promise<any>) | undefined} rootThunk
 */
async function walkClosure(rootName, rootThunk) {
  /** @type {Map<string, { id: string, res: ResolvedView | null, def: ViewDef | null }>} */
  const nodes = new Map();
  /** @type {Ref[]} */
  const refs = [];
  const refsByView = refsMap();

  async function visit(name, thunk, isRoot) {
    const id = canonical(name);
    if (nodes.has(id)) return;
    nodes.set(id, { id, res: null, def: null });

    if (isMetaKey(id)) {
      const own = refsByView.get(id) ?? [];
      refs.push(...own);
      await Promise.all(own.map((ref) => visit(ref.id, undefined, false)));
      return;
    }

    let res;
    try {
      res = await resolveViewModule(id, thunk);
    } catch (e) {
      if (isRoot) throw e;
      console.warn(`[theme-core] could not preload view '${id}'`, e);
      return;
    }
    const def = lookupDef(id);
    nodes.set(id, { id, res, def });
    if (!res) return;

    let children;
    if (res.source === "override") {
      children = refsByView.get(id) ?? [];
      refs.push(...children);
    } else {
      children = (def?.uses ?? []).map((use) => ({ id: use }));
    }
    await Promise.all(children.map((child) => visit(child.id, undefined, false)));
  }

  await visit(rootName, rootThunk, true);
  return { nodes, refs, rootId: canonical(rootName) };
}

/**
 * Resolves the given names and their closure into the sync cache that
 * getOverride / getDefault read.
 * @param {string[]} names
 */
export async function preloadViews(names) {
  await Promise.all(
    (names ?? []).map(async (name) => {
      try {
        await walkClosure(name, undefined);
      } catch (e) {
        console.warn(`[theme-core] could not preload view '${name}'`, e);
      }
    }),
  );
}

/**
 * Module for an injection: the preloaded view module (override markup, the
 * default's `load`). null when the id is unknown.
 * @param {string} id
 */
export async function loadForInjection(id) {
  await preloadViews([id]);
  const result = await resolveViewModule(id);
  // A plain copy that names the view (and where the markup came from), so `views.wrapInjected` can give the
  // injection its plugin's fallback scope (doc 03 section 4.4). The registry's own module is left alone.
  return result ? { ...result.module, __panoView: canonical(id), __panoSource: result.source } : null;
}

/** @type {((slotId: string, event: any) => Promise<any>) | null} */
let slotLoader = null;

/**
 * Overrides what runs a plugin slot's load (default: `executeViewLoad` of the
 * plugin API, imported on first use so this file has no static dependency on it).
 * @param {((slotId: string, event: any) => Promise<any>) | null} fn
 */
export function setSlotLoader(fn) {
  slotLoader = fn;
}

async function runSlotLoad(slotId, event) {
  try {
    const run = slotLoader ?? (await import("../lib/PluginAPI.js")).executeViewLoad;
    await run(slotId, event);
  } catch (e) {
    console.warn(`[theme-core] load of slot '${slotId}' failed`, e);
  }
}

/**
 * Resolves a view for a page / layout controller:
 * `{ View, "block:<key>": data, ... }`.
 *
 * Over the closure of `name` it also runs the `load` of every distinct
 * `<PluginBlock>` placement (one per `blockKey`) and the load of each plugin slot
 * a visited view opens, so injected parts are server-rendered.
 * @param {any} event  SvelteKit load event
 * @param {string} name
 * @param {() => Promise<any>} [defaultThunk]
 * @returns {Promise<{ View: any } & Record<string, any>>}
 */
export async function loadView(event, name, defaultThunk) {
  await waitForThemeConfig();
  const { nodes, refs, rootId } = await walkClosure(name, defaultThunk);
  const root = nodes.get(rootId);
  /** @type {Record<string, any>} */
  const out = { View: root?.res ? root.res.module.default : null };

  /** @type {Map<string, { ref: Ref, node: any }>} */
  const blocks = new Map();
  for (const ref of refs) {
    const node = nodes.get(canonical(ref.id));
    if (!node?.res || !node.def?.block) continue;
    const key = blockKey(ref.id, ref.props);
    if (!blocks.has(key)) blocks.set(key, { ref, node });
  }

  const slots = new Set();
  for (const node of nodes.values()) {
    for (const slot of node.def?.slots ?? []) if (isPluginSlot(slot)) slots.add(slot);
  }

  await Promise.all([
    ...[...blocks].map(async ([key, { ref, node }]) => {
      const mod = node.res.module;
      const load = mod?.load ?? mod?.default?.load;
      if (typeof load !== "function") {
        out[key] = {};
        return;
      }
      try {
        const data = await load(event, ref.props ?? {});
        out[key] = data ?? {};
      } catch (e) {
        console.warn(`[theme-core] load of block '${ref.id}' failed`, e);
      }
    }),
    ...[...slots].map((slot) => runSlotLoad(slot, event)),
  ]);

  return out;
}

// ---------------------------------------------------------------------------
// Test support
// ---------------------------------------------------------------------------

/**
 * Returns the registry to its pristine state (config, meta, every registered
 * view, caches, issues, the config-ready latch). Tests only.
 */
export function resetRegistryForTests() {
  themeConfig = {};
  themeMeta = { refs: {}, claims: [], homePages: {} };
  engineViews.clear();
  pluginViews.clear();
  nsOwners.clear();
  pluginToNs.clear();
  aliasVersion++;
  derived.config = derived.refs = derived.claims = null;
  clearResolution();
  issues.clear();
  slotLoader = null;
  configured = false;
  newReady();
}
