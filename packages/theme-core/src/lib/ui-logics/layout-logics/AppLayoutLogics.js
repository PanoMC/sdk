import { onDestroy, onMount, setContext } from "svelte";
import { get, writable } from "svelte/store";
import { setPanoContext } from "@panomc/sdk/internal";
import {
  getDefault,
  getOverride,
  getThemeConfig,
  getThemeProvides,
  hasView,
  resolveView,
  route,
  setThemeMeta,
} from "$pano/registry/index.js";
import { setRouteConfig } from "$pano/registry/routes.js";
import { _ } from "svelte-i18n";
import copy from "copy-to-clipboard";

import { browser } from "$app/environment";
import { goto, invalidate, invalidateAll } from "$app/navigation";
import { navigating, page } from "$app/stores";
import { base } from "$app/paths";
import { error, redirect } from "@sveltejs/kit";

import { avatarVersion, initialized } from "$pano/lib/Store";

import * as languageStuff from "$pano/lib/language.util";
import ApiUtil, * as ApiUtilStuff from "$pano/lib/api.util";
import * as variableStuff from "$pano/lib/variables";
import { checkDomainRedirection, updateApiUrl, updatePanoWebsiteUrl } from "$pano/lib/variables";
import * as toastStuff from "$pano/lib/components/ToastContainer.svelte";
import tooltip from "$pano/lib/tooltip.util";

import { addListener } from "$pano/lib/NotificationManager";
import { initializePlugins, preparePlugins } from "$pano/lib/PluginManager";
import { executeLifecycle, executeViewLoad, panoApi } from "$pano/lib/PluginAPI";
import { bindControllerSession, themeHostFactory } from "$pano/lib/controllerHost";
import { hasPermission } from "$pano/lib/auth.util";
import { trackPostView } from "$pano/lib/services/posts";

import DateComponent from "$pano/lib/components/Date.svelte";
import Pagination from "$pano/lib/components/Pagination.svelte";
import NoContent from "$pano/lib/components/NoContent.svelte";
import PageActions from "$pano/lib/components/PageActions.svelte";
import PageTitle from "$pano/lib/components/PageTitle.svelte";
import PlayerHead from "$pano/lib/components/PlayerHead.svelte";
import Toast from "$pano/lib/components/Toast.svelte";
import Sidebar from "$pano/lib/components/Sidebar.svelte";
import ViewComponent from "$pano/lib/components/ViewComponent.svelte";
import Hook from "$pano/lib/components/Hook.svelte";
import PluginBlock from "$pano/lib/components/PluginBlock.svelte";
import PluginSlot from "$pano/lib/components/PluginSlot.svelte";
import FallbackScope from "$pano/lib/components/FallbackScope.svelte";
import { buildStyleTable, createViewWrapper } from "$pano/lib/fallbackStyles.js";

const initLanguage = languageStuff.init;

/**
 * `virtual:pano-theme-meta` (doc 01 section 4): the view references, claims and home pages the build found in the
 * theme's own files. A theme without the virtual module (or one that fails to load) gets an empty meta.
 */
async function readThemeMeta() {
  try {
    const module = await import("virtual:pano-theme-meta");

    return module?.default ?? module ?? null;
  } catch {
    return null;
  }
}

/** The theme-side setup of the open front-end, done once per module instance (server process / browser page). */
let themeSetup = null;

function setupTheme() {
  themeSetup ??= (async () => {
    const themeConfig = getThemeConfig();

    // the generated hooks.js does this too; a hand-written one may not
    setRouteConfig(themeConfig);
    setThemeMeta(await readThemeMeta());
    panoApi.controllers.setHostFactory(themeHostFactory);
    panoApi.controllers.setThemePins(themeConfig.controllers);
  })();

  return themeSetup;
}

/**
 * The styles of every installed plugin, as plain data. `pano-plugin.json` is read on the server only, so the server
 * load hands this to the browser (doc 03 section 4.4: `styles` metadata). Cached per plugin and UI hash; in
 * development mode a rebuilt plugin is read again.
 */
const styleEntries = new Map();

/** The fallback-style wrapper of the latest load (it holds that load's plugin style table). */
let viewWrapper = null;

/**
 * `views.wrap` is the fallback-style hook of doc 03 section 4.4: a default plugin view gets the scoped fallback
 * sheet in a theme without Bootstrap; in every other theme it is the identity.
 * @param {string} name  `<ns>:<View>`
 * @param {Function} component
 * @param {"default" | "override"} source
 */
const wrapView = (name, component, source) => {
  const wrap = viewWrapper?.wrap;

  return typeof wrap === "function" ? wrap(name, component, source) : component;
};

/**
 * `views.wrapInjected` is the same hook for what an injection's `component` resolved to (a nav item, a sidebar
 * widget, a hook): a named view keeps its plugin's scope, a legacy component gets the `legacy` scope. In a theme with
 * Bootstrap it is the component itself.
 * @param {any} module  the resolved module (or component) of the injected item
 */
const wrapInjectedView = (module) => {
  const wrap = viewWrapper?.wrapInjected;

  return typeof wrap === "function" ? wrap(module) : (module?.default ?? module);
};

async function readStyleTable(siteInfo) {
  const { readPluginPackage } = await import("@panomc/sdk/core/js/pluginFolder.util.js");
  const found = [];

  for (const [id, info] of Object.entries(siteInfo?.plugins ?? {})) {
    if (!id || id.includes("/") || id.includes("\\") || id.startsWith(".")) continue;

    const uiHash = info?.version && typeof info.version === "object" ? info.version.uiHash : info?.uiHash;
    const cacheKey = `${id}:${uiHash ?? ""}`;
    const cacheable = Boolean(uiHash) && !siteInfo.developmentMode;
    let entry = cacheable ? styleEntries.get(cacheKey) : undefined;

    if (entry === undefined) {
      const pkg = readPluginPackage(`plugins/${id}`);

      entry = { id, namespace: pkg?.namespace, styles: pkg?.styles, views: pkg?.views };
      if (cacheable) styleEntries.set(cacheKey, entry);
    }

    found.push(entry);
  }

  return buildStyleTable(found);
}

const POST_VIEW_ENGAGEMENT_DELAY_MS = 8000;

async function sendVisitorVisitRequest({ event, csrfToken, isDemo }) {
  if (isDemo) return;
  ApiUtil.post({ path: "/visitor-visit", request: event, csrfToken });
}

function extractPostUrlFromPath(pathname) {
  if (!pathname || typeof pathname !== "string") {
    return null;
  }

  const normalizedPath = pathname.endsWith("/") && pathname.length > 1
    ? pathname.slice(0, -1)
    : pathname;

  const postPathMatch = normalizedPath.match(/^\/post\/([^/]+)$/);
  if (!postPathMatch || !postPathMatch[1]) {
    return null;
  }

  try {
    return decodeURIComponent(postPathMatch[1]);
  } catch (_error) {
    return postPathMatch[1];
  }
}

function initNotificationListeners() {
  addListener("AN_ADMIN_REPLIED_TICKET", async (notification) => {
    const {
      details: { id }
    } = notification;

    await goto("/ticket/" + id, { invalidateAll: true });
  });

  addListener("AN_ADMIN_CLOSED_TICKET", async (notification) => {
    const {
      details: { id }
    } = notification;

    await goto("/ticket/" + id, { invalidateAll: true });
  });
}

export async function processServerLoad(event) {
  const {
    locals: { user, csrfToken, apiUrlEnv, panoWebsiteUrlEnv }
  } = event;

  let siteInfo = await ApiUtil.get({
    path: "/site-info",
    request: event,
    csrfToken
  });

  await preparePlugins(siteInfo);

  const avatarVersionDate = `v=${Date.now()}`;
  const pluginStyles = await readStyleTable(siteInfo);

  return {
    user,
    csrfToken,
    siteInfo,
    pluginStyles,
    apiUrlEnv,
    panoWebsiteUrlEnv,
    avatarVersionDate,
  };
}

export async function processLoad(event) {
  const {
    data: {
      user,
      csrfToken,
      siteInfo,
      pluginStyles = {},
      apiUrlEnv,
      panoWebsiteUrlEnv,
      avatarVersionDate,
    },
    parent,
  } = event;
  await parent();
  await setupTheme();
  avatarVersion.set(avatarVersionDate);

  if (apiUrlEnv) {
    updateApiUrl(apiUrlEnv);
  }

  if (panoWebsiteUrlEnv) {
    updatePanoWebsiteUrl(panoWebsiteUrlEnv);
  }

  if (browser) {
    checkDomainRedirection();
  }

  const [
    ResolvedDate,
    ResolvedPagination,
    ResolvedNoContent,
    ResolvedPageActions,
    ResolvedPageTitle,
    ResolvedPlayerHead,
  ] = await Promise.all([
    resolveView("Date", async () => DateComponent),
    resolveView("Pagination", async () => Pagination),
    resolveView("NoContent", async () => NoContent),
    resolveView("PageActions", async () => PageActions),
    resolveView("PageTitle", async () => PageTitle),
    resolveView("PlayerHead", async () => PlayerHead),
  ]);

  viewWrapper = createViewWrapper({
    FallbackScope,
    getTable: () => pluginStyles,
    getProvides: getThemeProvides,
    dev: Boolean(siteInfo?.developmentMode),
  });

  setPanoContext({
    page,
    base,
    navigating,
    browser,
    goto,
    invalidate,
    invalidateAll,
    error,
    redirect,
    components: {
      Date: ResolvedDate,
      Pagination: ResolvedPagination,
      NoContent: ResolvedNoContent,
      PageActions: ResolvedPageActions,
      PageTitle: ResolvedPageTitle,
      PlayerHead: ResolvedPlayerHead,
      Toast,
      Sidebar,
      ViewComponent,
      Hook,
      PluginBlock,
      PluginSlot,
    },
    // read by the view proxies of plugin builds (`@panomc/sdk/views`), at render time
    views: {
      getOverride,
      getDefault,
      has: hasView,
      wrap: wrapView,
      wrapInjected: wrapInjectedView,
    },
    routes: {
      resolve: route,
    },
    utils: {
      api: {
        ApiUtil,
        ...ApiUtilStuff,
      },
      language: {
        ...languageStuff,
        _,
      },
      tooltip: {
        tooltip,
      },
      toast: {
        ...toastStuff,
      },
      auth: {
        hasPermission,
      },
      text: {
        copy,
      },
    },
    variables: {
      ...variableStuff,
    },
  });

  await initializePlugins(siteInfo);

  const output = {
    session: { user, csrfToken, siteInfo },
    pluginStyles,
    _pageTitleStore: writable(null),
    _breadcrumbsStore: writable(null)
  };

  // theme:navbar:load must run first — plugins may register items into
  // navbar-right / navbar-profile-dropdown views during this lifecycle.
  await executeLifecycle("theme:navbar:load", output, event);

  // After navbar lifecycle, the two view loads operate on independent viewIds,
  // theme:app:load writes to output but doesn't depend on view results,
  // and initLanguage is fully independent. Run them all in parallel.
  const [, , , language] = await Promise.all([
    executeViewLoad("navbar-right", event),
    executeViewLoad("navbar-profile-dropdown", event),
    executeLifecycle("theme:app:load", output, event),
    initLanguage(siteInfo.locale, event)
  ]);

  output.language = language;

  if (browser && !get(initialized)) {
    initNotificationListeners();
  }

  return output;
}

export function init(data) {
  // SSR: language stores are module-level; re-apply this request's language right before render.
  if (!browser) {
    languageStuff.activateLanguage(data.language);
  }

  const session = writable(data.session);
  const sidebar = writable(null);
  const sidebarProps = writable({});
  let activePostUrl = null;
  let postViewTimeoutId = null;

  const clearPendingPostViewTracking = () => {
    if (!browser || postViewTimeoutId === null) {
      return;
    }

    window.clearTimeout(postViewTimeoutId);
    postViewTimeoutId = null;
  };

  const schedulePostViewTracking = (postUrl) => {
    clearPendingPostViewTracking();

    if (!browser || !postUrl || document.visibilityState !== "visible") {
      return;
    }

    postViewTimeoutId = window.setTimeout(() => {
      if (document.visibilityState !== "visible" || activePostUrl !== postUrl) {
        return;
      }

      trackPostView({
        url: postUrl,
        csrfToken: get(session)?.csrfToken
      });
    }, POST_VIEW_ENGAGEMENT_DELAY_MS);
  };

  const pageUnsubscribe = page.subscribe((currentPage) => {
    session.update((current) => {
      const incoming = currentPage.data.session;
      if (!incoming) return current;

      if (!!current?.user !== !!incoming.user) {
        return { ...incoming, user: current.user, csrfToken: current.csrfToken };
      }

      return incoming;
    });
    sidebar.update(() => currentPage.data.sidebar);
    sidebarProps.update(() => currentPage.data.sidebarProps || {});
    // Sync pageTitle store from page load data.
    // Pages that return pageTitle in their load function will have it here.
    // Pages without a pageTitle will have undefined, clearing the old value.
    data._pageTitleStore.set(currentPage.data.pageTitle || null);
    // Breadcrumbs are opt-in per page: pages that want a breadcrumb must
    // return a `breadcrumbs` array from their load function. Pages that
    // don't provide one will clear any previous value.
    data._breadcrumbsStore.set(currentPage.data.breadcrumbs || null);

    if (!browser) {
      return;
    }

    activePostUrl = extractPostUrlFromPath(currentPage.url?.pathname);
    schedulePostViewTracking(activePostUrl);
  });

  setContext("session", session);
  setContext("sidebar", sidebar);
  setContext("sidebarProps", sidebarProps);
  setContext("pageTitle", data._pageTitleStore);
  setContext("breadcrumbs", data._breadcrumbsStore);
  setContext("themeSettings", data.session.siteInfo.themeSettings);

  // browser only: controllers read the session through the host (doc 02 section 1); the server host reads the request
  if (browser) {
    onDestroy(bindControllerSession(session));
  }

  const onVisibilityChange = () => {
    schedulePostViewTracking(activePostUrl);
  };

  if (browser) {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  onDestroy(() => {
    pageUnsubscribe();
    clearPendingPostViewTracking();

    if (browser) {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  });

  onMount(() => {
    initialized.set(true);

    sendVisitorVisitRequest({ isDemo: data.session.siteInfo.isDemo });
  });

  const pageTitle = data._pageTitleStore;
  const breadcrumbs = data._breadcrumbsStore;
  return { session, sidebar, sidebarProps, pageTitle, breadcrumbs };
}
