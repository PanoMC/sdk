// Route config of the active theme (doc 01 section 9). `route(path)` turns a canonical path into
// the path the theme publishes; `createReroute(themeConfig)` is the SvelteKit `reroute` hook that
// does the opposite for incoming requests.
import { createRouteMap } from "../kit/route-map.js";

/** Where a disabled route lands: the `(plugin-ui)/[...path]` catch-all answers it with a 404. */
export const DISABLED_PATH = "/__pano-disabled";

const identity = createRouteMap();
let current = identity;

/** @param {any} themeConfig */
function mapOf(themeConfig) {
  const routes = themeConfig?.routes;

  return routes && (routes.rename || routes.disable)
    ? createRouteMap({ rename: routes.rename, disable: routes.disable })
    : identity;
}

/**
 * Remember the route config of the theme. Call it once at start-up (the generated `hooks.js`);
 * no argument (or a config without `routes`) goes back to "no renames".
 * @param {any} [themeConfig]  the default export of `theme.config.js`
 */
export function setRouteConfig(themeConfig) {
  current = mapOf(themeConfig);
}

/**
 * Public path for a canonical path: `route("/store")` is `"/shop"` in a theme that renames it.
 * @param {string} path
 * @returns {string}
 */
export function route(path) {
  return typeof path === "string" ? current.toPublic(path) : path;
}

/** Inbound side of `route`, for `catch-all` pages: public pathname -> canonical (or `null` = disabled). */
export function resolveCanonical(pathname) {
  return current.toCanonical(pathname);
}

/**
 * SvelteKit `reroute` hook: public -> canonical, disabled -> `/__pano-disabled`. Returns
 * nothing when the path does not change, as SvelteKit expects.
 * @param {any} themeConfig
 * @returns {(input: { url: URL }) => string | undefined}
 */
export function createReroute(themeConfig) {
  const map = mapOf(themeConfig);

  return ({ url }) => {
    const canonical = map.toCanonical(url.pathname);

    if (canonical === null) {
      return DISABLED_PATH;
    }

    return canonical === url.pathname ? undefined : canonical;
  };
}
