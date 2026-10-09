import { load as loadApp } from "$pano/lib/layouts/AppLayout.svelte";
import { load as loadMain } from "$pano/lib/layouts/MainLayout.svelte";
import { engineViews } from "$pano/lib/views/parts/engine-views.generated.js";
import { getThemeConfig, loadView, registerEngineViews } from "$pano/registry/index.js";

// The engine's own views (Main, Sidebar, Breadcrumb, the toasts and the modals ...) are the registered defaults
// a theme's override is checked against. This module runs on the server and in the browser (it is the root
// layout load), so the table is registered before the first `loadView` of either side.
registerEngineViews(engineViews);

/**
 * Engine parts that are not rendered by a page or layout view: the six context
 * components (AppLayoutLogics) and the always-mounted parts (doc 01 §8).
 * Navbar / Header / Footer load in MainLayout.
 */
export const CHROME_VIEWS = [
  "Date",
  "Pagination",
  "NoContent",
  "PageActions",
  "PageTitle",
  "PlayerHead",
  "Main",
  "Sidebar",
  "Breadcrumb",
  "Toast",
  "DefaultToast",
  "ToastContainer",
  "NotificationContainer",
  "CloseTicketConfirmModal",
  "ConfirmRemoveAllNotificationsModal",
  "LogoutSessionConfirmModal",
  "HomeSidebar",
  "ProfileSidebar",
  "SupportSidebar",
  "PlayerDetailSidebar",
  "TicketCreateAndDetailSidebar",
];

/**
 * `loadView` for each chrome part the theme overrides: preloads the override and
 * everything it places, and returns the `block:` data of its <PluginBlock>s.
 * Parts without an override are skipped (no change for a theme that overrides
 * nothing). The `View` key is dropped: it belongs to the page.
 * @param {any} event  SvelteKit load event
 * @returns {Promise<Record<string, any>>}
 */
export async function loadChrome(event) {
  const views = getThemeConfig()?.views ?? {};
  const names = CHROME_VIEWS.filter((name) => views[name]);
  if (names.length === 0) return {};

  const results = await Promise.all(names.map((name) => loadView(event, name)));
  /** @type {Record<string, any>} */
  const out = {};
  for (const { View: _view, ...blocks } of results) Object.assign(out, blocks);
  return out;
}

/**
 * @type {import("@sveltejs/kit").LayoutLoad}
 */
export async function load(event) {
  const appData = await loadApp(event);
  const [mainData, chromeData] = await Promise.all([loadMain(event), loadChrome(event)]);

  return {
    ...appData,
    ...mainData,
    ...chromeData
  };
}
