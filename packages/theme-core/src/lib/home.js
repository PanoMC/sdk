// The home page (doc 01 section 9, decisions 6 and 33).
//
// The admin picks the home page of the active theme; the choice reaches the theme as `siteInfo.homePage`
// (`"store"` = an option of the theme, `"custom:/rules"` = a path the admin typed, `null` = the theme's
// default). `resolveHome` turns the choice, the theme's `home` config and the registered plugin pages into
// what `/` renders:
//
//   { kind: "posts" }            the posts feed (today's page)
//   { kind: "page", id }         a page of the theme (`home.options.<id>.page`)
//   { kind: "path", path }       the plugin page registered at a concrete canonical path
//
// A choice that cannot be shown falls back to `home.default`, then to the posts feed, with one
// console.warn each. The posts feed is always served at `/posts` as well.
import { findMatch } from "@panomc/sdk/core/js/RouteMatcher.js";

import { getThemeConfig, getThemeMeta } from "../registry/index.js";
import { route } from "../registry/routes.js";

/** @typedef {{ kind: "posts" } | { kind: "page", id: string } | { kind: "path", path: string }} Home */

const POSTS_PATH = "/posts";
const CUSTOM_PREFIX = "custom:";
const PREFIX = "[theme-core] home page:";

/** @param {string} reason */
const problem = (reason) => ({ problem: reason });
/** @param {Home} home */
const found = (home) => ({ home });

/**
 * @param {any} themeConfig  the default export of theme.config.js
 * @param {string | null | undefined} homePage  `siteInfo.homePage`
 * @param {Record<string, any> | null | undefined} registeredPages  the plugin pages by path; `null` / `undefined`
 *   = not known here: a path is then taken as it is, without looking for the page
 * @param {{ homePages?: Record<string, unknown>, warn?: (message: string) => void }} [options]
 *   `homePages` = the page options the build found (a `page` option without a file is refused);
 *   `warn` = how a fallback is reported (default `console.warn`)
 * @returns {Home}
 */
export function resolveHome(themeConfig, homePage, registeredPages, options = {}) {
  const { homePages, warn = console.warn } = options;
  const home = themeConfig?.home && typeof themeConfig.home === "object" ? themeConfig.home : null;
  const configured = home !== null;
  const themeOptions = configured && home.options && typeof home.options === "object" ? home.options : {};

  /** @param {unknown} path */
  function checkPath(path) {
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) {
      return problem(`"${path}" is not a path of this site`);
    }

    const clean = path.split(/[?#]/)[0];

    if (/\[[^\]]*\]/.test(clean)) {
      return problem(`"${clean}" is a route pattern, give a concrete path (for example /store/vip)`);
    }

    if (clean === POSTS_PATH) {
      return found({ kind: "posts" });
    }

    if (registeredPages === null || registeredPages === undefined) {
      return found({ kind: "path", path: clean });
    }

    const page = findMatch(registeredPages, clean);

    if (!page) {
      return problem(`no page is registered at "${clean}" (is its plugin installed and on?)`);
    }

    if (page.systemLayout) {
      return problem(`"${clean}" is rendered inside a system layout and cannot be the home page`);
    }

    if (page.layout) {
      return problem(`"${clean}" brings its own layout and cannot be the home page`);
    }

    return found({ kind: "path", path: clean });
  }

  /** @param {string} value */
  function resolveValue(value) {
    if (value === "posts") {
      return found({ kind: "posts" });
    }

    if (value.startsWith(CUSTOM_PREFIX)) {
      const offered = !configured || Object.values(themeOptions).some((option) => /** @type {any} */ (option)?.path === "*");

      return offered ? checkPath(value.slice(CUSTOM_PREFIX.length)) : problem(`this theme does not offer a custom path`);
    }

    if (configured) {
      const option = themeOptions[value];

      if (!option || typeof option !== "object") {
        return problem(`"${value}" is not one of the options of the theme`);
      }

      if (typeof option.page === "string") {
        return homePages && !homePages[value] ? problem(`option "${value}" has no page file`) : found({ kind: "page", id: value });
      }

      if (option.path === "*") {
        return problem(`option "${value}" needs a path from the admin (use custom:/path)`);
      }

      return typeof option.path === "string" ? checkPath(option.path) : problem(`option "${value}" has neither a page nor a path`);
    }

    // No `home` in the theme config: a plugin page offers itself with `view.home`, the option id is its view id.
    if (registeredPages === null || registeredPages === undefined) {
      return found({ kind: "path", path: "/" });
    }

    const entry = Object.entries(registeredPages).find(([, page]) => page?.home && page.view === value);

    return entry ? checkPath(entry[0]) : problem(`"${value}" is not a home page option (is its plugin installed and on?)`);
  }

  if (typeof homePage === "string" && homePage !== "") {
    const result = resolveValue(homePage);

    if ("home" in result) {
      return result.home;
    }

    warn(`${PREFIX} "${homePage}" is not available (${result.problem}); using the default of the theme`);
  }

  const defaultId = configured && typeof home.default === "string" && home.default !== "" ? home.default : "posts";

  if (defaultId !== "posts") {
    const result = resolveValue(defaultId);

    if ("home" in result) {
      return result.home;
    }

    warn(`${PREFIX} home.default "${defaultId}" is not available (${result.problem}); showing the posts`);
  }

  return { kind: "posts" };
}

/**
 * True for the route of the posts feed (`/posts`, whatever the theme renamed it to): `route.id` is
 * `/(theme)/posts`, SvelteKit's id of the route that matched after `reroute`.
 * @param {any} event  SvelteKit load event
 * @returns {boolean}
 */
export function isPostsRoute(event) {
  const id = event?.route?.id;

  return typeof id === "string" && id.replace(/\/\([^/)]*\)/g, "") === POSTS_PATH;
}

/**
 * What the home route renders for this request. `/posts` is always the feed; `/` follows the setting.
 * Waits for the layout first: the plugin pages are registered by then.
 * @param {any} event  SvelteKit load event
 * @param {() => Record<string, any>} getRegisteredPages  the current plugin pages (the table is replaced on a rebuild)
 * @returns {Promise<Home>}
 */
export async function resolveHomeFor(event, getRegisteredPages) {
  if (isPostsRoute(event)) {
    return { kind: "posts" };
  }

  const parentData = await event.parent();

  return resolveHome(getThemeConfig(), parentData?.session?.siteInfo?.homePage ?? null, getRegisteredPages(), {
    homePages: getThemeMeta()?.homePages,
  });
}

/**
 * True while `/` shows the posts feed. Cheap, safe to call while rendering: the choice is read as it is
 * (the pages a plugin registered are not looked at, so a choice whose plugin is off still counts as "not
 * posts" here and the feed links then point at `/posts`, which always works).
 * @param {{ homePage?: string | null } | null | undefined} siteInfo
 * @returns {boolean}
 */
export function homeIsPosts(siteInfo) {
  try {
    return resolveHome(getThemeConfig(), siteInfo?.homePage ?? null, null, { warn: () => {} }).kind === "posts";
  } catch {
    return true;
  }
}

/**
 * The link to the posts feed (and so to its categories and pages): `/` while it is the home page,
 * `/posts` otherwise, through `route()`.
 * @param {{ homePage?: string | null } | null | undefined} siteInfo
 * @returns {string}
 */
export function postsPath(siteInfo) {
  return route(homeIsPosts(siteInfo) ? "/" : POSTS_PATH);
}
