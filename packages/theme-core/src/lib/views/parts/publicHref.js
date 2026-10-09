// The public form of a site link (doc 01 section 9): a canonical path such as "/store/vip" becomes the path
// the theme publishes ("/shop/vip" when it renames "/store"). The query string and the hash are kept as they
// are; an absolute URL, a protocol-relative one or anything that is not a site path passes unchanged.
import { route } from "../../../registry/routes.js";

/**
 * @param {unknown} href
 * @returns {unknown}
 */
export function publicHref(href) {
  if (typeof href !== "string" || !href.startsWith("/") || href.startsWith("//")) {
    return href;
  }

  const cut = href.search(/[?#]/);

  return cut === -1 ? route(href) : route(href.slice(0, cut)) + href.slice(cut);
}
