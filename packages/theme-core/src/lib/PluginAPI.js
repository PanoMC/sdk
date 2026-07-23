import { baseAPI, pageAPI } from "@panomc/sdk/core/js/PluginAPI";
import { get, writable } from "svelte/store";
import { plugins } from "@panomc/sdk/core/js/PluginManager.js";
import { sortSiteNavLinks } from "./orderNavLinks.util.js";
import { avatarVersion } from "./Store.js";
import { browser } from "$app/environment";
import {
  createHookEngine,
  createLifecycleRegistry,
  createSlotRegistry,
} from "$pano/plugin-engine/engine.js";

// All the ordering / SSR-safe-clone / hook-load machinery lives in the shared plugin engine.
// This file is the THEME profile: it composes the engine registries into the theme's `pano.ui.*`
// namespace tree and re-exports the host contract (init, panoApiClient, panoApiServer).
const lifecycle = createLifecycleRegistry();
const hooks = createHookEngine();
const slots = createSlotRegistry({
  getPlugins: () => get(plugins),
  browser,
  executeLifecycle: lifecycle.executeLifecycle,
  lifecyclePrefix: "theme",
});

// Theme-specific: the ordered site navigation links (uses the theme's sort util, not a plain slot).
const siteNavLinks = writable([]);

export async function init() {
  hooks.reset();
  slots.reset();
  siteNavLinks.set([]);
  lifecycle.reset();
}

export const executeLifecycle = lifecycle.executeLifecycle;
export const executeSidebarLoad = slots.executeSidebarLoad;
export const executeViewLoad = slots.executeViewLoad;
export const executeHookLoad = hooks.executeHookLoad;

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
            const { resolveView } = await import("$pano/registry/index.js");
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
            const { resolveView } = await import("$pano/registry/index.js");
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
