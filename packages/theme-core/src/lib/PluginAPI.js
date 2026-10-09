import { baseAPI, createFeatureSet, pageAPI } from "@panomc/sdk/core/js/PluginAPI";
import { derived, get, writable } from "svelte/store";
import * as pluginManager from "@panomc/sdk/core/js/PluginManager.js";
import { sortSiteNavLinks } from "./orderNavLinks.util.js";
import { addPluginListener, resetPluginListeners } from "@panomc/sdk/core/js/NotificationManager.js";
import { avatarVersion } from "./Store.js";
import { controllers } from "@panomc/sdk/core/js/ControllerRegistry.js";
import { browser } from "$app/environment";
import { redirect } from "@sveltejs/kit";
// Engine-internal imports are relative: they resolve to the same files as the `$pano/...` alias, and a
// module that holds state (the registry) must be one instance whichever spelling reaches it.
import { buildLoginUrl, returnToFromUrl } from "./returnTo.util.js";
import {
  describeView,
  getClaims,
  hasView,
  loadForInjection,
  registerViews,
  resetPluginViews,
  route,
} from "../registry/index.js";
import {
  createHookEngine,
  createLifecycleRegistry,
  createSlotRegistry,
} from "../plugin-engine/engine.js";

// All the ordering / SSR-safe-clone / hook-load machinery lives in the shared plugin engine.
// This file is the THEME profile: it composes the engine registries into the theme's `pano.ui.*`
// namespace tree and re-exports the host contract (init, panoApiClient, panoApiServer).

// ---------------------------------------------------------------------------
// Named views (doc 01 sections 3 and 5)
// ---------------------------------------------------------------------------

/** @type {Map<string, string>} view id -> pluginId that registered it (first writer wins, like the registry's namespace guard) */
const viewOwners = new Map();
/** @type {Map<string, string>} pluginId -> ns, for the `<pluginId>:<Name>` alias */
const pluginNamespaces = new Map();

/** Levenshtein distance, for the "closest registered name" hint. */
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = row[j];
      row[j] = next;
    }
  }
  return row[b.length];
}

/** The registered plugin view id nearest to `id`, or null when nothing was registered. */
function closestViewName(id) {
  let best = null;
  let bestDistance = Infinity;
  for (const name of viewOwners.keys()) {
    const d = distance(id.toLowerCase(), name.toLowerCase());
    if (d < bestDistance) {
      best = name;
      bestDistance = d;
    }
  }
  return best;
}

/** `<pluginId>:<Name>` -> `<ns>:<Name>`; anything else unchanged. */
function canonicalViewId(id) {
  if (typeof id !== "string") return id;
  const at = id.indexOf(":");
  if (at <= 0) return id;
  const ns = pluginNamespaces.get(id.slice(0, at));
  return ns ? ns + id.slice(at) : id;
}

/**
 * Items the theme places itself with `<PluginBlock>` or `claims` are left out of slots and hooks
 * (doc 01 section 5): `getClaims().has(item.view)`, with the alias spelling understood too.
 * @param {{ view?: string }} item
 */
function isSuppressed(item) {
  if (typeof item?.view !== "string") return false;
  const claims = getClaims();
  return claims.has(item.view) || claims.has(canonicalViewId(item.view));
}

function labelOf(item) {
  return item.id ?? item.name ?? item.path ?? "?";
}

/**
 * Run on every registered, edited or upserted item (slot items, hook entries, pages).
 *
 * - `view` set: `item.component = () => loadForInjection(view)`, only when `component` is unset or
 *   `item._view !== item.view`, so a module `executeComponentLoad` already stored in the item is not
 *   blanked by a later `edit`. An unknown view id drops the item and names the closest registered view.
 * - a function / object `component` without `view` is dropped with an error naming the replacement (SDK 2.0).
 * - nothing else is touched (engine items such as `component: "local:profile-nav"`).
 *
 * Mutates and returns `item`; null = drop. Idempotent.
 * @param {any} item
 */
export function normalizeItem(item) {
  if (!item || typeof item !== "object") return item;

  if (typeof item.view === "string" && item.view) {
    const id = item.view;

    if (!hasView(id)) {
      const owner = item.pluginId ? `${item.pluginId}: ` : "";
      const nearest = closestViewName(canonicalViewId(id));
      console.error(
        `[pano] ${owner}'${labelOf(item)}' names view '${id}', which is not registered` +
          (nearest ? ` (closest registered view: '${nearest}')` : "") +
          "; the item is dropped",
      );
      return null;
    }

    if (item.component === undefined || item.component === null || item._view !== item.view) {
      item.component = () => loadForInjection(id);
      item._view = id;
    }
    return item;
  }

  if (typeof item.component === "function" || (item.component && typeof item.component === "object")) {
    // SDK 2.0: the un-named form is gone. Engine items (string components) are not plugin items.
    console.error(
      `[pano] ${item.pluginId ?? "a plugin"}: '${labelOf(item)}' is registered with 'component', which SDK 2.0 no longer accepts; the item is dropped. Use export const view = { hook: '...' } in a view file`,
    );
    return null;
  }

  return item;
}

const lifecycle = createLifecycleRegistry();
const hooks = createHookEngine({ normalizeItem, isSuppressed });
const slots = createSlotRegistry({
  getPlugins: () => get(pluginManager.plugins),
  browser,
  executeLifecycle: lifecycle.executeLifecycle,
  lifecyclePrefix: "theme",
  normalizeItem,
  isSuppressed,
});

// Theme-specific: the ordered site navigation links (uses the theme's sort util, not a plain slot).
const siteNavLinks = writable([]);
// What `getNavLinks()` hands out: the same links with `href` mapped through the theme's route config.
// Mapped on read, so a link is never mapped twice and a route config set later still applies.
const publicNavLinks = derived(siteNavLinks, ($links) =>
  $links.map((link) => (typeof link?.href === "string" ? { ...link, href: route(link.href) } : link)),
);

/** A site-relative URL goes through `route()`; absolute, protocol-relative and other values pass unchanged. */
function toPublicUrl(url) {
  return typeof url === "string" && url.startsWith("/") && !url.startsWith("//") ? route(url) : url;
}

/** `goto` for plugins: a renamed route lands on its public path. */
export async function routedGoto(url, options) {
  const { goto } = await import("$app/navigation");

  return goto(toPublicUrl(url), options);
}

/** `redirect` for plugins (throws like SvelteKit's): a renamed route lands on its public path. */
export function routedRedirect(status, location) {
  return redirect(status, toPublicUrl(location));
}

/**
 * `pano.views.add`: called by the generated entry wrapper before the author's `onLoad`.
 * Registers the defaults with the registry, then applies their page / inject / home metadata.
 * @param {Array<object>} defs  ViewDef[] (doc 01 section 3)
 */
function addViews(defs) {
  const list = (Array.isArray(defs) ? defs : []).filter((def) => def && typeof def === "object");
  const accepted = [];

  for (const def of list) {
    const name = def.name;
    const owner = viewOwners.get(name);

    // The registry rejects a def whose namespace belongs to another plugin; the side effects follow it.
    if (owner !== undefined && def.pluginId !== undefined && owner !== def.pluginId) continue;

    accepted.push(def);
  }

  registerViews(accepted);

  for (const def of accepted) {
    if (!hasView(def.name)) continue;

    viewOwners.set(def.name, def.pluginId ?? "");
    const ns = def.name.slice(0, def.name.indexOf(":"));
    if (def.pluginId) pluginNamespaces.set(def.pluginId, ns);
  }

  for (const def of accepted) {
    if (!viewOwners.has(def.name)) continue;

    const pluginId = def.pluginId;

    if (def.page && typeof def.page === "object" && def.page.path) {
      panoApi.ui.page.register({
        ...def.page,
        view: def.name,
        pluginId,
        ...(def.home ? { home: def.home } : {}),
        ...(def.block ? { block: true } : {}),
      });
    }

    for (const inject of def.inject ?? []) {
      if (!inject || typeof inject !== "object") continue;

      const id = inject.id ?? def.name;
      const priority = inject.priority;
      const each = (value) => (Array.isArray(value) ? value : value ? [value] : []);

      for (const viewId of each(inject.slot)) {
        panoApi.ui.view.register({ viewId, id, view: def.name, pluginId, ...(priority !== undefined ? { priority } : {}) });
      }
      for (const sidebarId of each(inject.sidebar)) {
        // a sidebar item gets the prop `sidebarId` (doc 01 section 2)
        panoApi.ui.sidebar.register({
          sidebarId,
          id,
          view: def.name,
          pluginId,
          props: { sidebarId },
          ...(priority !== undefined ? { priority } : {}),
        });
      }
      for (const name of each(inject.hook)) {
        panoApi.ui.hook.register({
          name,
          id,
          view: def.name,
          pluginId,
          ...(inject.skipLoad ? { skipLoad: true } : {}),
          ...(inject.permission ? { permission: inject.permission } : {}),
        });
      }
    }
  }
}

export async function init() {
  // plugin views and controllers are forgotten with everything else a plugin registered
  resetPluginViews();
  controllers.reset();
  viewOwners.clear();
  pluginNamespaces.clear();
  hooks.reset();
  slots.reset();
  siteNavLinks.set([]);
  lifecycle.reset();
  resetPluginListeners();
}

export const executeLifecycle = lifecycle.executeLifecycle;
export const executeSidebarLoad = slots.executeSidebarLoad;
export const executeViewLoad = slots.executeViewLoad;
export const executeHookLoad = hooks.executeHookLoad;

// Capability ids this theme announces through `pano.features` (see the feature table of the
// market plugin spec). Plugins test `pano.features?.has(id)`.
export const THEME_FEATURE_IDS = [
  "login-return-url",
  "page-meta",
  "page-title-options",
  "page-sidebar-id",
  "profile-nav",
  "context-components",
  "toast-escaped-values",
  "decoded-route-params",
  "layout-route-params",
  "plugin-notifications",
  "named-views",
  "plugin-slots",
  "blocks",
  "route-map",
];

export const panoApi = {
  ...baseAPI,
  features: createFeatureSet(THEME_FEATURE_IDS),
  // Named views (doc 01 section 3): `add` is the generated call, `has` / `describe` are read-only.
  views: {
    add: addViews,
    has: (id) => hasView(id),
    describe: (id) => describeView(id),
  },
  // Public controllers (doc 02 section 2): `use`, `load`, `has`, `list`, `register`, ...
  controllers,
  // Route config of the active theme: `pano.routes.resolve("/store")` is the path the theme publishes.
  routes: {
    resolve: route,
  },
  // Login return URL for plugin pages: `pano.auth.loginUrl("/store/checkout")`. `pano.ui.auth`
  // (the login / register view slots) is a different namespace and is untouched.
  auth: {
    loginUrl: (returnTo) => route(buildLoginUrl(returnTo)),
    returnTo: (url) => returnToFromUrl(url),
    // Use in a plugin page `load(event)`: guests are sent to `/login?redirect=<this page>`.
    async requireLogin(event) {
      const { session } = await event.parent();

      if (!session.user) {
        throw routedRedirect(302, buildLoginUrl(event.url.pathname + event.url.search));
      }
    },
  },
  ui: {
    ...pageAPI,
    // `view: "<ns>:<Name>"` instead of `component` (doc 01 section 3); the SDK's register stores the page.
    page: {
      ...pageAPI.page,
      register(page) {
        const normalized = normalizeItem({ ...page });

        if (normalized) pageAPI.page.register(normalized);
      },
    },
    nav: {
      site: {
        editNavLinks(callback) {
          siteNavLinks.update((links) => {
            const next = callback(links) || links;
            return sortSiteNavLinks(next);
          });
        },
        getNavLinks() {
          return publicNavLinks;
        },
      },
      profileDropdown: {
        edit(callback) {
          slots.edit("navbar-profile-dropdown", callback);
        },
        get() {
          return panoApi.ui.view.get("navbar-profile-dropdown");
        },
      },
      rightComponents: {
        edit(callback) {
          slots.edit("navbar-right", callback);
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
      // Profile sidebar navigation: items `{ id, priority, hidden?, props: { href, text, icon?, startsWith?, badge? } }`.
      nav: {
        edit(callback) {
          slots.edit("profile-nav", callback);
        },
        get() {
          return panoApi.ui.view.get("profile-nav");
        },
      },
      content: {
        edit(callback) {
          slots.edit("profile-content", callback);
        },
        get() {
          return panoApi.ui.view.get("profile-content");
        },
      },
      cardRows: {
        edit(callback) {
          slots.edit("profile-card-rows", callback);
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
          slots.edit("settings-content", callback);
        },
        get() {
          return panoApi.ui.view.get("settings-content");
        },
      },
      cardRows: {
        edit(callback) {
          slots.edit("settings-card-rows", callback);
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
          slots.edit("tickets-content", callback);
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
            slots.edit("login-content", callback);
          },
          get() {
            return panoApi.ui.view.get("login-content");
          },
        },
        alternativeMethods: {
          add(method) {
            slots.upsert("login-alt-methods", method);
          },
          get() {
            return panoApi.ui.view.get("login-alt-methods");
          },
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
            // Registry-resolved: a theme overriding LoginFormBody restyles the
            // form everywhere plugins mount it, too.
            const { resolveView } = await import("../registry/index.js");
            return resolveView(
              "LoginFormBody",
              () => import("$pano/lib/components/LoginFormBody.svelte"),
            );
          },
        },
      },
      register: {
        content: {
          edit(callback) {
            slots.edit("register-content", callback);
          },
          get() {
            return panoApi.ui.view.get("register-content");
          },
        },
        alternativeMethods: {
          add(method) {
            slots.upsert("register-alt-methods", method);
          },
          get() {
            return panoApi.ui.view.get("register-alt-methods");
          },
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
            const { resolveView } = await import("../registry/index.js");
            return resolveView(
              "RegisterForm",
              () => import("$pano/lib/components/RegisterForm.svelte"),
            );
          },
        },
      },
      resetPassword: {
        content: {
          edit(callback) {
            slots.edit("reset-password-content", callback);
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
            slots.edit("activate-content", callback);
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
            slots.edit("activate-new-email-content", callback);
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
            slots.edit("renew-password-content", callback);
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
        slots.register(options);
      },
      hide(viewId, id) {
        slots.hide(viewId, id);
      },
      show(viewId, id) {
        slots.show(viewId, id);
      },
      move(viewId, id, priority) {
        slots.move(viewId, id, priority);
      },
      get(viewId) {
        return slots.get(viewId);
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
    notification: {
      // Click handler for a plugin-defined notification type; runs after the core listeners.
      onClick(type, handler) {
        addPluginListener(type, handler);
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
        lifecycle.on(name, handler);
      },
      // General primitive: run any theme lifecycle so plugin pages can take part in theme flows
      // (e.g. a plugin login/register page running the same lifecycle the theme's own pages do).
      async execute(name, data = {}, event) {
        await lifecycle.executeLifecycle(name, data, event);
        return data;
      },
    },
    hook: {
      register(options) {
        hooks.register(options);
      },
      get(name) {
        return hooks.get(name);
      },
      setVisible(name, component, visible) {
        hooks.setVisible(name, component, visible);
      },
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

export const panoApiServer = {
  ...panoApi,
};

export const panoApiClient = {
  ...panoApi,
};
