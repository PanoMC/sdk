import { onDestroy, onMount, setContext } from "svelte";
import { get, writable } from "svelte/store";
import { setPanoContext } from "@panomc/sdk/internal";
import { resolveView } from "$pano/registry/index.js";
import { _ } from "svelte-i18n";
import copy from "copy-to-clipboard";

import { browser } from "$app/environment";
import { goto } from "$app/navigation";
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
import { executeLifecycle, executeViewLoad } from "$pano/lib/PluginAPI";
import { hasPermission } from "$pano/lib/auth.util";
import { trackPostView } from "$pano/lib/services/posts";

import DateComponent from "$pano/lib/components/Date.svelte";
import Pagination from "$pano/lib/components/Pagination.svelte";
import NoContent from "$pano/lib/components/NoContent.svelte";
import PageActions from "$pano/lib/components/PageActions.svelte";
import PageTitle from "$pano/lib/components/PageTitle.svelte";
import PlayerHead from "$pano/lib/components/PlayerHead.svelte";

const initLanguage = languageStuff.init;
const POST_VIEW_ENGAGEMENT_DELAY_MS = 8000;

async function sendVisitorVisitRequest({ event, csrfToken, isDemo }) {
  if (isDemo) return;
  ApiUtil.post({ path: "/api/visitorVisit", request: event, csrfToken });
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
    path: "/api/siteInfo",
    request: event,
    csrfToken
  });

  await preparePlugins(siteInfo);

  const avatarVersionDate = `v=${Date.now()}`;

  return {
    user,
    csrfToken,
    siteInfo,
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
      apiUrlEnv,
      panoWebsiteUrlEnv,
      avatarVersionDate,
    },
    parent,
  } = event;
  await parent();
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

  setPanoContext({
    page,
    base,
    navigating,
    browser,
    goto,
    error,
    redirect,
    components: {
      Date: ResolvedDate,
      Pagination: ResolvedPagination,
      NoContent: ResolvedNoContent,
      PageActions: ResolvedPageActions,
      PageTitle: ResolvedPageTitle,
      PlayerHead: ResolvedPlayerHead,
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
    _pageTitleStore: writable(null),
    _breadcrumbsStore: writable(null)
  };

  // theme:navbar:load must run first — plugins may register items into
  // navbar-right / navbar-profile-dropdown views during this lifecycle.
  await executeLifecycle("theme:navbar:load", output, event);

  // After navbar lifecycle, the two view loads operate on independent viewIds,
  // theme:app:load writes to output but doesn't depend on view results,
  // and initLanguage is fully independent. Run them all in parallel.
  await Promise.all([
    executeViewLoad("navbar-right", event),
    executeViewLoad("navbar-profile-dropdown", event),
    executeLifecycle("theme:app:load", output, event),
    initLanguage(siteInfo.locale, event)
  ]);

  if (browser && !get(initialized)) {
    initNotificationListeners();
  }

  return output;
}

export function init(data) {
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
