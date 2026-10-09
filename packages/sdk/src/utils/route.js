import { getPanoContext } from "../internal/index.js";

/**
 * Maps a canonical site path to the path the active theme publishes it under
 * (`@panomc/sdk/utils/route`, doc 01 section 9). A theme that renames a route in
 * `theme.config.js` makes `route("/profile")` answer the new path; outside a theme
 * (or before the theme registered its route map) the path is returned unchanged.
 *
 * @param {string} p canonical path, optionally with a query string or hash
 * @returns {string}
 */
export function route(p) {
  const resolve = getPanoContext().context?.routes?.resolve;

  return typeof resolve === "function" ? resolve(p) : p;
}
