import { baseAPI, pageAPI } from "@panomc/sdk/core/js/PluginAPI";
import { derived, get, writable } from "svelte/store";
import { plugins } from "@panomc/sdk/core/js/PluginManager.js";
import { sortSiteNavLinks } from "./orderNavLinks.util.js";
import { avatarVersion } from "./Store.js";
import { browser } from "$app/environment";

const hooks = writable({});
const uiItems = writable({});
const siteNavLinks = writable([]);

// Monotonic registration counter. Captured on each view-slot item at register time so equal-priority
// items can be sorted deterministically (instead of relying on array insertion order, which can
// differ between the SSR and client bundles) -> stable widget order across SSR and hydration.
let viewItemSeq = 0;

// Monotonic registration counter for hooks. Plugins call hook.register() in a deterministic order on
// both the server and the client, so this index is identical across bundles -> a stable hook order.
let hookItemSeq = 0;

// Sort hooks by their stable registration index. The previous implementation sorted by the hook's
// importer `.toString()`, but that source contains build-specific chunk hashes that differ between
// the server and client bundles, so the two sides produced different orders -> hydration mismatch.
function sortHooks(rawHooks) {
  return [...rawHooks].sort((a, b) => {
    const seqA = a._seq ?? 0;
    const seqB = b._seq ?? 0;
    if (seqA !== seqB) return seqA - seqB;
    // Deterministic tiebreak on a stable id so the total order never depends on bundle internals.
    return String(a.id ?? a.name ?? "").localeCompare(String(b.id ?? b.name ?? ""));
  });
}

// Deduplicate items by id, keeping the last occurrence
function deduplicateById(arr) {
  const seen = new Map();
  for (const item of arr) {
    if (item.id) seen.set(item.id, item);
    else seen.set(Symbol(), item);
  }
  arr.length = 0;
  arr.push(...seen.values());
}

// Deep-clone a slot item's serializable parts without touching its `component`
// (a function / component module that is not structured-cloneable). Used on the server so
// resolved load() props are merged into a per-request copy instead of the shared global entry.
function structuredCloneSafe(item) {
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

// Version-based UI caching using plugin IDs and versions
const uiLoadedCacheKeys = new Map(); // Map<containerId, pluginCacheKey>

function generatePluginCacheKey() {
  const loadedPlugins = get(plugins);
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

export async function init() {
  hooks.set({});
  uiItems.set({});
  siteNavLinks.set([]);
  lifecycleHandlers.set({});
  uiLoadedCacheKeys.clear();
}

const lifecycleHandlers = writable({});

export async function executeLifecycle(name, data, event) {
  const handlers = get(lifecycleHandlers)[name] || [];
  await Promise.allSettled(
    handlers.map(async (handler) => {
      try {
        await handler(data, event);
      } catch (e) {
        console.error(`[Lifecycle:${name}] failed`, e);
      }
    })
  );
}

export async function executeSidebarLoad(sidebarId, event) {
  await executeLifecycle(`theme:sidebar:${sidebarId}:load`, {}, event);
  return await executeComponentLoad(sidebarId, "Sidebar", event);
}

export async function executeViewLoad(viewId, event) {
  await executeLifecycle(`theme:view:${viewId}:load`, {}, event);
  return await executeComponentLoad(viewId, "View", event);
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

export const panoApi = {
  ...baseAPI,
  ui: {
    ...pageAPI,
    nav: {
      site: {
        editNavLinks(callback) {
          siteNavLinks.update((links) => {
            const next = callback(links) || links;
            return sortSiteNavLinks(next);
          });
        },
        getNavLinks() {
          return siteNavLinks;
        },
      },
      profileDropdown: {
        edit(callback) {
          uiItems.update((items) => {
            if (!items["navbar-profile-dropdown"]) items["navbar-profile-dropdown"] = [];
            callback(items["navbar-profile-dropdown"]);
            deduplicateById(items["navbar-profile-dropdown"]);
            return items;
          });
        },
        get() {
          return panoApi.ui.view.get("navbar-profile-dropdown");
        },
      },
      rightComponents: {
        edit(callback) {
          uiItems.update((items) => {
            if (!items["navbar-right"]) items["navbar-right"] = [];
            callback(items["navbar-right"]);
            deduplicateById(items["navbar-right"]);
            return items;
          });
        },
        get() {
          return panoApi.ui.view.get("navbar-right");
        },
      },
      onLoad(handler) {
        panoApi.ui.lifecycle.on("theme:navbar:load", handler);
      },
    },
    profile: {
      content: {
        edit(callback) {
          uiItems.update((items) => {
            if (!items["profile-content"]) items["profile-content"] = [];
            callback(items["profile-content"]);
            deduplicateById(items["profile-content"]);
            return items;
          });
        },
        get() {
          return panoApi.ui.view.get("profile-content");
        },
      },
      cardRows: {
        edit(callback) {
          uiItems.update((items) => {
            if (!items["profile-card-rows"]) items["profile-card-rows"] = [];
            callback(items["profile-card-rows"]);
            deduplicateById(items["profile-card-rows"]);
            return items;
          });
        },
        get() {
          return panoApi.ui.view.get("profile-card-rows");
        },
      },
      onLoad(handler) {
        panoApi.ui.lifecycle.on("theme:profile:load", handler);
      },
    },
    settings: {
      content: {
        edit(callback) {
          uiItems.update((items) => {
            if (!items["settings-content"]) items["settings-content"] = [];
            callback(items["settings-content"]);
            deduplicateById(items["settings-content"]);
            return items;
          });
        },
        get() {
          return panoApi.ui.view.get("settings-content");
        },
      },
      cardRows: {
        edit(callback) {
          uiItems.update((items) => {
            if (!items["settings-card-rows"]) items["settings-card-rows"] = [];
            callback(items["settings-card-rows"]);
            deduplicateById(items["settings-card-rows"]);
            return items;
          });
        },
        get() {
          return panoApi.ui.view.get("settings-card-rows");
        },
      },
      onLoad(handler) {
        panoApi.ui.lifecycle.on("theme:settings:load", handler);
      },
    },
    tickets: {
      content: {
        edit(callback) {
          uiItems.update((items) => {
            if (!items["tickets-content"]) items["tickets-content"] = [];
            callback(items["tickets-content"]);
            deduplicateById(items["tickets-content"]);
            return items;
          });
        },
        get() {
          return panoApi.ui.view.get("tickets-content");
        },
      },
      onLoad(handler) {
        panoApi.ui.lifecycle.on("theme:tickets:load", handler);
      },
    },
    auth: {
      login: {
        content: {
          edit(callback) {
            uiItems.update((items) => {
              if (!items["login-content"]) items["login-content"] = [];
              callback(items["login-content"]);
              deduplicateById(items["login-content"]);
              return items;
            });
          },
          get() {
            return panoApi.ui.view.get("login-content");
          },
        },
        alternativeMethods: {
          add(method) {
            uiItems.update((items) => {
              if (!items["login-alt-methods"]) items["login-alt-methods"] = [];
              const existing = items["login-alt-methods"].findIndex((i) => i.id === method.id);
              if (existing !== -1) {
                items["login-alt-methods"][existing] = method;
              } else {
                items["login-alt-methods"].push(method);
              }
              return items;
            });
          },
          get() {
            return panoApi.ui.view.get("login-alt-methods");
          }
        },
        onLoad(handler) {
          panoApi.ui.lifecycle.on("theme:login:load", handler);
        },
        // A plugin page that presents a login (e.g. social login) runs the same load as the
        // theme's login page, so login-content plugins (captcha, 2FA, …) populate and render.
        async load(event) {
          const data = { error: null, username: null, event };
          await executeLifecycle("theme:login:load", data, event);
          await executeViewLoad("login-content", event);
          await executeViewLoad("login-alt-methods", event);
          return data;
        },
        // Theme-provided login form body. Entry-adapter plugins (social-login, magic-link, …)
        // mount this Svelte component so their pages look identical to the theme's /login form.
        form: {
          async get() {
            const m = await import("$pano/lib/components/LoginFormBody.svelte");
            return m.default;
          },
        },
      },
      register: {
        content: {
          edit(callback) {
            uiItems.update((items) => {
              if (!items["register-content"]) items["register-content"] = [];
              callback(items["register-content"]);
              deduplicateById(items["register-content"]);
              return items;
            });
          },
          get() {
            return panoApi.ui.view.get("register-content");
          },
        },
        alternativeMethods: {
          add(method) {
            uiItems.update((items) => {
              if (!items["register-alt-methods"]) items["register-alt-methods"] = [];
              const existing = items["register-alt-methods"].findIndex((i) => i.id === method.id);
              if (existing !== -1) {
                items["register-alt-methods"][existing] = method;
              } else {
                items["register-alt-methods"].push(method);
              }
              return items;
            });
          },
          get() {
            return panoApi.ui.view.get("register-alt-methods");
          }
        },
        onLoad(handler) {
          panoApi.ui.lifecycle.on("theme:register:load", handler);
        },
        // A plugin page that presents a registration (e.g. social register) runs the same load as
        // the theme's register page, so register-content plugins (captcha, …) populate and render.
        async load(event) {
          const data = { error: null, username: null, event };
          await executeLifecycle("theme:register:load", data, event);
          await executeViewLoad("register-content", event);
          await executeViewLoad("register-alt-methods", event);
          return data;
        },
        // Theme-provided register form body. See login.form for rationale.
        form: {
          async get() {
            const m = await import("$pano/lib/components/RegisterForm.svelte");
            return m.default;
          },
        },
      },
      resetPassword: {
        content: {
          edit(callback) {
            uiItems.update((items) => {
              if (!items["reset-password-content"]) items["reset-password-content"] = [];
              callback(items["reset-password-content"]);
              deduplicateById(items["reset-password-content"]);
              return items;
            });
          },
          get() {
            return panoApi.ui.view.get("reset-password-content");
          },
        },
        onLoad(handler) {
          panoApi.ui.lifecycle.on("theme:reset-password:load", handler);
        },
      },
      activate: {
        content: {
          edit(callback) {
            uiItems.update((items) => {
              if (!items["activate-content"]) items["activate-content"] = [];
              callback(items["activate-content"]);
              deduplicateById(items["activate-content"]);
              return items;
            });
          },
          get() {
            return panoApi.ui.view.get("activate-content");
          },
        },
        onLoad(handler) {
          panoApi.ui.lifecycle.on("theme:activate:load", handler);
        },
      },
      activateNewEmail: {
        content: {
          edit(callback) {
            uiItems.update((items) => {
              if (!items["activate-new-email-content"]) items["activate-new-email-content"] = [];
              callback(items["activate-new-email-content"]);
              deduplicateById(items["activate-new-email-content"]);
              return items;
            });
          },
          get() {
            return panoApi.ui.view.get("activate-new-email-content");
          },
        },
        onLoad(handler) {
          panoApi.ui.lifecycle.on("theme:activate-new-email:load", handler);
        },
      },
      renewPassword: {
        content: {
          edit(callback) {
            uiItems.update((items) => {
              if (!items["renew-password-content"]) items["renew-password-content"] = [];
              callback(items["renew-password-content"]);
              deduplicateById(items["renew-password-content"]);
              return items;
            });
          },
          get() {
            return panoApi.ui.view.get("renew-password-content");
          },
        },
        onLoad(handler) {
          panoApi.ui.lifecycle.on("theme:renew-password:load", handler);
        },
      },
    },
    app: {
      onLoad(handler) {
        panoApi.ui.lifecycle.on("theme:app:load", handler);
      },
    },
    view: {
      register(options) {
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
              _seq: items[viewId][existingIdx]._seq ?? viewItemSeq++,
            };
          } else {
            items[viewId].push({ id, component, priority, hidden: false, _seq: viewItemSeq++ });
          }
          return items;
        });
      },
      hide(viewId, id) {
        uiItems.update((items) => {
          if (!items[viewId]) return items;
          const item = items[viewId].find((i) => i.id === id);
          if (item) item.hidden = true;
          return items;
        });
      },
      show(viewId, id) {
        uiItems.update((items) => {
          if (!items[viewId]) return items;
          const item = items[viewId].find((i) => i.id === id);
          if (item) item.hidden = false;
          return items;
        });
      },
      move(viewId, id, priority) {
        uiItems.update((items) => {
          if (!items[viewId]) return items;
          const item = items[viewId].find((i) => i.id === id);
          if (item) item.priority = priority;
          return items;
        });
      },
      get(viewId) {
        return derived(uiItems, ($items) => {
          return ($items[viewId] || [])
            .filter((item) => !item.hidden)
            .sort((a, b) => {
              // Primary: higher priority first.
              if (b.priority !== a.priority) return b.priority - a.priority;
              // Secondary (deterministic): registration sequence, so equal-priority items keep a
              // stable order across SSR and client instead of depending on array insertion order.
              const seqA = a._seq ?? 0;
              const seqB = b._seq ?? 0;
              if (seqA !== seqB) return seqA - seqB;
              // Final tiebreak: id, so the total order is fully deterministic.
              return String(a.id ?? "").localeCompare(String(b.id ?? ""));
            });
        });
      },
      onLoad(viewId, handler) {
        panoApi.ui.lifecycle.on(`theme:view:${viewId}:load`, handler);
      },
      // General: a plugin page hosting a theme view slot can run its load lifecycle and get the
      // resolved (plugin-contributed) items, so injected components render exactly as in the theme.
      async load(viewId, event) {
        return await executeViewLoad(viewId, event);
      },
    },
    sidebar: {
      register(options) {
        const { sidebarId, ...rest } = options;
        panoApi.ui.view.register({ viewId: sidebarId, ...rest });
      },
      hide(sidebarId, id) {
        panoApi.ui.view.hide(sidebarId, id);
      },
      show(sidebarId, id) {
        panoApi.ui.view.show(sidebarId, id);
      },
      move(sidebarId, id, priority) {
        panoApi.ui.view.move(sidebarId, id, priority);
      },
      get(sidebarId) {
        return panoApi.ui.view.get(sidebarId);
      },
      onLoad(sidebarId, handler) {
        panoApi.ui.lifecycle.on(`theme:sidebar:${sidebarId}:load`, handler);
      },
    },
    post: {
      onLoad(handler) {
        panoApi.ui.lifecycle.on("theme:post-detail:load", handler);
      },
    },
    support: {
      onLoad(handler) {
        panoApi.ui.lifecycle.on("theme:support:load", handler);
      },
    },
    lifecycle: {
      on(name, handler) {
        lifecycleHandlers.update((h) => {
          if (!h[name]) h[name] = [];
          h[name].push(handler);
          return h;
        });
      },
      // General primitive: run any theme lifecycle so plugin pages can take part in theme flows
      // (e.g. a plugin login/register page running the same lifecycle the theme's own pages do).
      async execute(name, data = {}, event) {
        await executeLifecycle(name, data, event);
        return data;
      },
    },
    hook: {
      register(options) {
        const { name } = options;
        // Stamp a stable registration index so server and client sort hooks identically.
        const entry = options._seq === undefined ? { ...options, _seq: hookItemSeq++ } : options;
        hooks.update(h => {
          if (!h[name]) h[name] = [];
          h[name].push(entry);
          return h;
        });
      },
      get(name) {
        return derived(hooks, $h => {
          // Sort by stable registration order. Deterministic order is crucial for server-client
          // prop synchronization (see sortHooks).
          return sortHooks($h[name] || []);
        });
      },
      setVisible(name, component, visible) {
        hooks.update(h => {
          if (!h[name]) return h;
          const idx = h[name].findIndex(item => item.component === component || item.component?._original === component);
          if (idx !== -1) {
            h[name][idx].invisible = !visible;
          }
          return h;
        });
      }
    },
    avatar: {
      updateVersion() {
        avatarVersion.set(`&v=${Date.now()}`);
      },
      getVersion() {
        return avatarVersion;
      },
    },
  },
};

const hookExecutionCache = new WeakMap();
const componentLoadCache = new WeakMap();

export async function executeHookLoad(name, originalEvent) {
  // Prevent double execution of the SAME hook name during the same load cycle
  const event = originalEvent ? { ...originalEvent, hookName: name } : { hookName: name };
  // Use originalEvent as a stable cache key if possible, otherwise fall back to the local event object
  const cacheKey = (originalEvent && typeof originalEvent === "object") ? originalEvent : event;

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
        hooks.update(h => {
          if (h[name]) {
            // Find the actual index in the original unsorted array
            const actualIdx = h[name].findIndex(item => (item.component || item) === raw);
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
    })
  );

  // Cache the final results for this specific hook name
  if (cacheKey && results.length > 0) {
    const cache = hookExecutionCache.get(cacheKey);
    cache[name] = results;
  }

  return results;
}

export const panoApiServer = {
  ...panoApi,
};

export const panoApiClient = {
  ...panoApi,
};
