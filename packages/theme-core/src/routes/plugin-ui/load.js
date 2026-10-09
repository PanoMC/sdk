// The load of a plugin page, shared by the `(plugin-ui)/[...path]` catch-all (`Page.svelte`) and the home
// route (`lib/pages/HomePage.svelte`) when the admin makes a plugin page the home page (doc 01 section 9).
//
// Engine-internal imports are relative: they resolve to the same files as the `$pano/...` alias, and this
// module stays loadable without the SvelteKit aliases. Everything that needs a `.svelte` file or the plugin
// manager (the host sidebars, the permission check, the page table) is handed in by the caller.
import { error, redirect } from "@sveltejs/kit";
// `panoApi.controllers` is this very singleton (lib/PluginAPI.js re-exports it); the direct import keeps this
// module free of the plugin manager.
import { controllers } from "@panomc/sdk/core/js/ControllerRegistry.js";

import { loadView, resolveViewModule, getThemeMeta } from "../../registry/index.js";
import { resolveSidebarSpec } from "../../lib/components/sidebars/sidebarSpec.util.js";
import { loginRedirectFor } from "../../lib/returnTo.util.js";
import { themePageLoad } from "../../lib/themePageLoad.js";

/**
 * What a caller provides for the sidebar of a page whose `load` returns a string such as `"home"`.
 * @typedef {{
 *   hosts: { home: object, profile: object },
 *   PluginSidebar: object,
 *   executeSidebarLoad: (sidebarId: string, event: any) => Promise<unknown>,
 *   countVisible: (sidebarId: string) => number,
 * }} SidebarDeps
 */

/**
 * Loads the matched plugin page: the view through the registry (the theme's override or the plugin's
 * default, plus the data of everything it places) or the legacy component, then its `load`.
 * @param {any} event  SvelteKit load event
 * @param {any} registeredPage  the entry of `registeredPages` (`findMatch` output, with `params`)
 * @param {SidebarDeps} sidebar
 * @returns {Promise<Record<string, any>>}
 */
export async function loadPluginPage(event, registeredPage, sidebar) {
  let componentOutput = {};

  // Inject plugin-specific params into the event
  if (registeredPage.params) {
    event.params = { ...event.params, ...registeredPage.params };
  }

  // A page registered from a named view (`view: "<ns>:<Name>"`) goes through the registry: the theme's
  // override (markup only) or the plugin's default, plus the `block:` data and slot loads of everything
  // the view places. `component.load` is the default's, so an override gets the very same data.
  let component = null;
  let source = "default";
  let blocks = {};

  if (registeredPage.view) {
    const { View: _view, ...blockData } = await loadView(event, registeredPage.view);
    const resolved = await resolveViewModule(registeredPage.view);

    if (!resolved) {
      throw error(404, "Not found");
    }

    component = resolved.module;
    source = resolved.source;
    blocks = blockData;
  } else {
    component = await registeredPage.component();
  }

  if (component.load !== undefined) {
    // A module `load` always wins.
    componentOutput = await component.load(event);
  } else if (registeredPage.view && registeredPage.controller) {
    // A page declared with `view = { path, controller }` and no `load` of its own gets the controller's data
    // (doc 02 section 4). `<ns>` is the namespace of the view id.
    const ns = String(registeredPage.view).split(":")[0];
    componentOutput =
      (await controllers.load(`${ns}/${registeredPage.controller}`, { event, params: event.params })) ?? {};
  }

  const output = { registeredPage, component, props: componentOutput, viewSource: source, ...blocks };

  // Expose layout-consumed fields from the component's load output
  // at the top level so they end up on page.data (e.g. pageTitle is
  // read by AppLayout/MainLayout to set <title> and the PageTitle component).
  if (componentOutput && typeof componentOutput === "object") {
    for (const key of ["pageTitle", "breadcrumbs", "sidebar", "sidebarProps", "meta"]) {
      if (componentOutput[key] !== undefined) {
        output[key] = componentOutput[key];
      }
    }
  }

  // `sidebar` as a string ("home", "profile", "plugin:<sidebarId>") names a host or engine
  // sidebar instead of passing a component; a component value is left untouched.
  const resolved = await resolveSidebarSpec({
    sidebar: output.sidebar,
    sidebarProps: output.sidebarProps,
    event,
    hosts: sidebar.hosts,
    PluginSidebar: sidebar.PluginSidebar,
    executeSidebarLoad: sidebar.executeSidebarLoad,
    countVisible: sidebar.countVisible,
  });

  if (resolved) {
    output.sidebar = resolved.sidebar;
    if (resolved.sidebarProps !== undefined) output.sidebarProps = resolved.sidebarProps;
  }

  return output;
}

/**
 * What `HomePage.svelte` hands in for a home page that is not the posts feed.
 * @typedef {{
 *   sidebar: SidebarDeps,
 *   hasPermission: (permission: string, user: any) => boolean,
 *   findPage: (path: string) => any,
 * }} HomeDeps
 */

/**
 * Loads the home page when it is a page of the theme (`kind: "page"`: its own `load` plus the blocks it places)
 * or a plugin page (`kind: "path"`: `findMatch` on the canonical path, then the same load as the catch-all).
 * The data carries `homeKind` for `HomePage.svelte`. Returns `null` when the page cannot be shown to this
 * visitor (no page any more, or a permission the visitor lacks): the caller shows the posts feed then.
 * A guest on a `loginRequired` page goes to login and comes back.
 * @param {any} event  SvelteKit load event
 * @param {{ kind: "page", id: string } | { kind: "path", path: string }} home
 * @param {HomeDeps} deps
 * @returns {Promise<Record<string, any> | null>}
 */
export async function loadHomeTarget(event, home, deps) {
  if (home.kind === "page") {
    const thunk = /** @type {any} */ (getThemeMeta()?.homePages)?.[home.id];

    if (typeof thunk !== "function") {
      return null;
    }

    const mod = await thunk();
    const own = await themePageLoad(`home:${home.id}`, mod)(event);

    return { ...own, homeKind: "page", HomeComponent: mod.default };
  }

  const registeredPage = deps.findPage(home.path);

  if (!registeredPage) {
    return null;
  }

  const {
    session: { user },
  } = await event.parent();

  const loginTarget = loginRedirectFor(registeredPage, user, { pathname: event.url.pathname, search: event.url.search });

  if (loginTarget) {
    throw redirect(302, loginTarget);
  }

  if (registeredPage.permission && !deps.hasPermission(registeredPage.permission, user)) {
    return null;
  }

  const output = await loadPluginPage(event, registeredPage, deps.sidebar);

  // The page is served at `/` as well as at its own path: `/` is the address search engines should keep.
  output.meta = { ...(output.meta && typeof output.meta === "object" ? output.meta : {}) };

  if (output.meta.canonical === undefined) {
    output.meta.canonical = "/";
  }

  return { ...output, homeKind: "path" };
}
