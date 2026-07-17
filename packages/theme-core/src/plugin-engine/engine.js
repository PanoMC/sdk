/**
 * Pano plugin engine — the profile-agnostic machinery shared by every PluginAPI profile
 * (the theme profile in `$lib/PluginAPI.js` and the panel profile in panel-ui).
 *
 * A "profile" is the thin file plugins actually import (`$lib/PluginAPI.js`). It composes the
 * factories exported here — {@link createLifecycleRegistry}, {@link createHookEngine},
 * {@link createSlotRegistry} — into its own `pano.*` namespace tree and re-exports the host
 * contract (`init`, `panoApiClient`, `panoApiServer`). All the ordering/caching/SSR-safety
 * fixes live here once, so both profiles get them.
 *
 * Nothing in this module reads SvelteKit app aliases ($app/environment, the PluginManager) or a
 * theme's utils directly — the profile injects `plugins` and `browser` so this file stays a pure,
 * portable engine that both the theme and panel bundles can consume.
 */

import { derived, get, writable } from "svelte/store";

// ---------------------------------------------------------------------------
// Pure utilities
// ---------------------------------------------------------------------------

/**
 * Deduplicate items by id, keeping the last occurrence. Items without an id are all kept
 * (each gets a fresh Symbol key). Mutates `arr` in place.
 */
export function deduplicateById(arr) {
  const seen = new Map();
  for (const item of arr) {
    if (item.id) seen.set(item.id, item);
    else seen.set(Symbol(), item);
  }
  arr.length = 0;
  arr.push(...seen.values());
}

/**
 * Deep-clone a slot item's serializable parts without touching its `component`
 * (a function / component module that is not structured-cloneable). Used on the server so
 * resolved load() props are merged into a per-request copy instead of the shared global entry.
 */
export function structuredCloneSafe(item) {
  const { component, ...rest } = item;
  let cloned;
  try {
    cloned = structuredClone(rest);
  } catch {
    // Fallback for values structuredClone can't handle: JSON round-trip the plain data.
    try {
      cloned = JSON.parse(JSON.stringify(rest));
    } catch {
      cloned = { ...rest, props: rest.props ? { ...rest.props } : undefined };
    }
  }
  cloned.component = component;
  return cloned;
}

/**
 * Sort hooks by their stable registration index. Sorting by the hook's importer `.toString()`
 * is unsafe — that source contains build-specific chunk hashes that differ between the server
 * and client bundles, so the two sides produce different orders -> hydration mismatch. The
 * monotonic `_seq` captured at register time is identical across bundles, so it is the only
 * deterministic key.
 */
export function sortHooks(rawHooks) {
  return [...rawHooks].sort((a, b) => {
    const seqA = a._seq ?? 0;
    const seqB = b._seq ?? 0;
    if (seqA !== seqB) return seqA - seqB;
    // Deterministic tiebreak on a stable id so the total order never depends on bundle internals.
    return String(a.id ?? a.name ?? "").localeCompare(String(b.id ?? b.name ?? ""));
  });
}

/**
 * Comparator for view-slot items: higher priority first, then stable registration sequence
 * (so equal-priority items keep a stable order across SSR and client instead of depending on
 * array insertion order), then id as the final deterministic tiebreak.
 */
export function compareViewItems(a, b) {
  if (b.priority !== a.priority) return b.priority - a.priority;
  const seqA = a._seq ?? 0;
  const seqB = b._seq ?? 0;
  if (seqA !== seqB) return seqA - seqB;
  return String(a.id ?? "").localeCompare(String(b.id ?? ""));
}

/** A private monotonic counter. Each registry gets its own so hook/view sequences never collide. */
export function createSeq() {
  let n = 0;
  return () => n++;
}

// ---------------------------------------------------------------------------
// Lifecycle registry
// ---------------------------------------------------------------------------

/**
 * Named lifecycle hooks (theme:profile:load, panel:posts:load, …). Handlers run with
 * Promise.allSettled so one throwing handler never blocks the others.
 */
export function createLifecycleRegistry() {
  const lifecycleHandlers = writable({});

  function on(name, handler) {
    lifecycleHandlers.update((h) => {
      if (!h[name]) h[name] = [];
      h[name].push(handler);
      return h;
    });
  }

  async function executeLifecycle(name, data, event) {
    const handlers = get(lifecycleHandlers)[name] || [];
    await Promise.allSettled(
      handlers.map(async (handler) => {
        try {
          await handler(data, event);
        } catch (e) {
          console.error(`[Lifecycle:${name}] failed`, e);
        }
      }),
    );
  }

  function reset() {
    lifecycleHandlers.set({});
  }

  return { lifecycleHandlers, on, executeLifecycle, reset };
}

// ---------------------------------------------------------------------------
// Hook engine
// ---------------------------------------------------------------------------

/**
 * Registry of render "hooks" — components mounted into named extension points that can also
 * contribute load() props. Deterministic ordering (via {@link sortHooks}) is crucial for
 * server/client prop synchronization; without it SSR and CSR insertion order drift and hydrate
 * out of sync.
 */
export function createHookEngine() {
  const hooks = writable({});
  const nextSeq = createSeq();

  const hookExecutionCache = new WeakMap();
  const componentLoadCache = new WeakMap();

  function register(options) {
    const { name } = options;
    // Stamp a stable registration index so server and client sort hooks identically.
    const entry = options._seq === undefined ? { ...options, _seq: nextSeq() } : options;
    hooks.update((h) => {
      if (!h[name]) h[name] = [];
      h[name].push(entry);
      return h;
    });
  }

  function getHook(name) {
    return derived(hooks, ($h) => {
      // Sort by stable registration order. Deterministic order is crucial for server-client
      // prop synchronization (see sortHooks).
      return sortHooks($h[name] || []);
    });
  }

  function setVisible(name, component, visible) {
    hooks.update((h) => {
      if (!h[name]) return h;
      const idx = h[name].findIndex(
        (item) => item.component === component || item.component?._original === component,
      );
      if (idx !== -1) {
        h[name][idx].invisible = !visible;
      }
      return h;
    });
  }

  async function executeHookLoad(name, originalEvent) {
    // Prevent double execution of the SAME hook name during the same load cycle
    const event = originalEvent ? { ...originalEvent, hookName: name } : { hookName: name };
    // Use originalEvent as a stable cache key if possible, otherwise fall back to the local event object
    const cacheKey = originalEvent && typeof originalEvent === "object" ? originalEvent : event;

    if (cacheKey) {
      if (!hookExecutionCache.has(cacheKey)) {
        hookExecutionCache.set(cacheKey, {});
      }
      const cache = hookExecutionCache.get(cacheKey);
      if (cache[name]) {
        return cache[name];
      }
    }

    const $h = get(hooks);
    // MUST match the sort order used in the 'get' accessor (see sortHooks).
    let list = sortHooks($h[name] || []);

    // Resolve all modules and execute load functions in parallel
    const results = await Promise.all(
      list.map(async (entry) => {
        const raw = entry.component || entry;
        let module = raw;
        if (typeof raw === "function" && !raw.prototype) {
          module = await raw();
          // Cache the resolved module back into the hooks store
          hooks.update((h) => {
            if (h[name]) {
              // Find the actual index in the original unsorted array
              const actualIdx = h[name].findIndex((item) => (item.component || item) === raw);
              if (actualIdx !== -1) {
                const resolved = { ...module, _original: raw };
                if (module.default) resolved.default = module.default;

                if (h[name][actualIdx].component) {
                  h[name][actualIdx].component = resolved;
                } else {
                  // Preserve the stable registration index so re-sorting stays deterministic.
                  h[name][actualIdx] = { ...resolved, _seq: h[name][actualIdx]._seq };
                }
              }
            }
            return h;
          });
        } else if (typeof raw !== "object" || !raw.default) {
          module = { default: raw };
        }

        let props = {};
        const Component = module.default || module;
        const loadFn = module.load || (Component && Component.load);

        if (loadFn && !entry.skipLoad) {
          // PER-EVENT COMPONENT CACHE: reuse results if this component already loaded for another hook in this event
          let eventCache = null;
          if (cacheKey) {
            if (!componentLoadCache.has(cacheKey)) componentLoadCache.set(cacheKey, new Map());
            eventCache = componentLoadCache.get(cacheKey);
          }

          if (eventCache && eventCache.has(module)) {
            props = eventCache.get(module);
          } else {
            try {
              props = await loadFn(event);
              if (eventCache) eventCache.set(module, props);
            } catch (e) {
              console.warn(`[Hook:${name}] Load failed`, e);
            }
          }
        }
        return props && typeof props === "object" ? { ...props } : {};
      }),
    );

    // Cache the final results for this specific hook name
    if (cacheKey && results.length > 0) {
      const cache = hookExecutionCache.get(cacheKey);
      cache[name] = results;
    }

    return results;
  }

  function reset() {
    hooks.set({});
  }

  return { hooks, register, get: getHook, setVisible, executeHookLoad, reset };
}

// ---------------------------------------------------------------------------
// Slot registry (view slots / sidebars / component containers)
// ---------------------------------------------------------------------------

/**
 * Registry of view-slot items — the components plugins inject into named containers
 * (profile-content, navbar-right, login-content, …), plus the SSR-safe load() pipeline that
 * resolves their code-split modules and merges their load() props.
 *
 * @param {object} deps
 * @param {() => Record<string, any>} deps.getPlugins  returns the current plugin map (already
 *   `get()`-resolved from the PluginManager `plugins` store). A thunk, not the store itself, so
 *   this factory never reads the store at construction — the PluginManager<->PluginAPI import
 *   cycle would otherwise put that binding in the temporal dead zone at module-eval time.
 * @param {boolean} deps.browser  `$app/environment`'s browser flag — decides whether to clone
 *   items per-request on the server.
 * @param {(name: string, data: any, event: any) => Promise<void>} [deps.executeLifecycle]
 *   the lifecycle registry's executor, used by executeViewLoad/executeSidebarLoad.
 * @param {string} [deps.lifecyclePrefix]  lifecycle-event namespace (default "theme").
 */
export function createSlotRegistry({ getPlugins, browser, executeLifecycle, lifecyclePrefix = "theme" }) {
  const uiItems = writable({});
  const nextSeq = createSeq();

  // Version-based UI caching using plugin IDs and versions
  const uiLoadedCacheKeys = new Map(); // Map<containerId, pluginCacheKey>

  function generatePluginCacheKey() {
    const loadedPlugins = getPlugins();
    if (!loadedPlugins || typeof loadedPlugins !== "object") {
      return "";
    }
    return Object.keys(loadedPlugins)
      .sort()
      .map((pluginId) => {
        const plugin = loadedPlugins[pluginId];
        const version = plugin.version?.version || plugin.version || "dev";
        return `${pluginId}:${version}`;
      })
      .join(",");
  }

  /** The register+dedupe pattern shared by every `.content.edit` / `.cardRows.edit` helper. */
  function edit(slotId, callback) {
    uiItems.update((items) => {
      if (!items[slotId]) items[slotId] = [];
      callback(items[slotId]);
      deduplicateById(items[slotId]);
      return items;
    });
  }

  /** Upsert a raw item by id (no dedup/priority/seq stamping) — used by alternativeMethods.add. */
  function upsert(slotId, item) {
    uiItems.update((items) => {
      if (!items[slotId]) items[slotId] = [];
      const existing = items[slotId].findIndex((i) => i.id === item.id);
      if (existing !== -1) {
        items[slotId][existing] = item;
      } else {
        items[slotId].push(item);
      }
      return items;
    });
  }

  function register(options) {
    const { viewId, id, component, priority = 10 } = options;
    uiItems.update((items) => {
      if (!items[viewId]) items[viewId] = [];
      const existingIdx = items[viewId].findIndex((i) => i.id === id);
      if (existingIdx !== -1) {
        items[viewId][existingIdx] = {
          ...items[viewId][existingIdx],
          component,
          priority,
          // Keep the original registration sequence on re-registration so order stays stable.
          _seq: items[viewId][existingIdx]._seq ?? nextSeq(),
        };
      } else {
        items[viewId].push({ id, component, priority, hidden: false, _seq: nextSeq() });
      }
      return items;
    });
  }

  function hide(viewId, id) {
    uiItems.update((items) => {
      if (!items[viewId]) return items;
      const item = items[viewId].find((i) => i.id === id);
      if (item) item.hidden = true;
      return items;
    });
  }

  function show(viewId, id) {
    uiItems.update((items) => {
      if (!items[viewId]) return items;
      const item = items[viewId].find((i) => i.id === id);
      if (item) item.hidden = false;
      return items;
    });
  }

  function move(viewId, id, priority) {
    uiItems.update((items) => {
      if (!items[viewId]) return items;
      const item = items[viewId].find((i) => i.id === id);
      if (item) item.priority = priority;
      return items;
    });
  }

  function getView(viewId) {
    return derived(uiItems, ($items) => {
      return ($items[viewId] || []).filter((item) => !item.hidden).sort(compareViewItems);
    });
  }

  async function executeComponentLoad(containerId, type, event) {
    const freshPluginCacheKey = generatePluginCacheKey();

    // Cache check removed because UI items are dynamic and rebuilt on navigation

    const items = get(uiItems)[containerId] || [];

    const resolvedItems = await Promise.all(
      items.map(async (item) => {
        let module = item.component;
        if (typeof item.component === "function" && !item.component.prototype) {
          try {
            module = await item.component();
          } catch (e) {
            console.error(`[${type}:${containerId}] Failed to load component ${item.id}`, e);
            return item;
          }
        }

        if (!module) return item;

        const Component = module.default || module;
        const loadFn = module.load || (Component && Component.load);

        let props = null;
        if (loadFn) {
          try {
            props = await loadFn(event);
          } catch (e) {
            console.warn(`[${type}:${containerId}:${item.id}] Load failed`, e);
          }
        }

        // The uiItems store is a process-global singleton, so on the server it is shared across all
        // concurrent requests. A shallow spread of `item` keeps `item.props` (and `item.props.data`)
        // aliased to the global registration entry, so merging resolved load() props would mutate that
        // shared entry -> cross-request data leak and SSR/client divergence. Deep-clone the item's
        // serializable parts on the server so we only ever mutate a per-request copy.
        const baseItem = browser ? item : structuredCloneSafe(item);
        const updatedItem = { ...baseItem, component: module };
        if (props && typeof props === "object" && Object.keys(props).length > 0) {
          if (!updatedItem.props) updatedItem.props = {};
          updatedItem.props.data = { ...updatedItem.props.data, ...props };
        }

        return updatedItem;
      }),
    );

    uiItems.update((current) => ({ ...current, [containerId]: resolvedItems }));
    uiLoadedCacheKeys.set(containerId, freshPluginCacheKey);

    return resolvedItems;
  }

  async function executeViewLoad(viewId, event) {
    if (executeLifecycle) {
      await executeLifecycle(`${lifecyclePrefix}:view:${viewId}:load`, {}, event);
    }
    return await executeComponentLoad(viewId, "View", event);
  }

  async function executeSidebarLoad(sidebarId, event) {
    if (executeLifecycle) {
      await executeLifecycle(`${lifecyclePrefix}:sidebar:${sidebarId}:load`, {}, event);
    }
    return await executeComponentLoad(sidebarId, "Sidebar", event);
  }

  function reset() {
    uiItems.set({});
    uiLoadedCacheKeys.clear();
  }

  return {
    uiItems,
    uiLoadedCacheKeys,
    generatePluginCacheKey,
    edit,
    upsert,
    register,
    hide,
    show,
    move,
    get: getView,
    executeComponentLoad,
    executeViewLoad,
    executeSidebarLoad,
    reset,
  };
}
