/**
 * Applies a saved id order to a combined list (native + plugin links).
 * Matches the theme settings UI: dedupe order, then known order first, then
 * remaining links in source order.
 *
 * @template {{ id: string }} T
 * @param {T[]} allLinks
 * @param {string[] | undefined} savedOrder
 * @returns {T[]}
 */
export function orderLinksBySavedOrder(allLinks, savedOrder) {
  let orderIds = savedOrder || [];
  orderIds = [...new Set(orderIds)];
  const sorted = [];
  const sourceMap = new Map(allLinks.map((l) => [l.id, l]));

  for (const id of orderIds) {
    if (sourceMap.has(id)) {
      sorted.push(sourceMap.get(id));
      sourceMap.delete(id);
    }
  }
  for (const link of sourceMap.values()) {
    sorted.push(link);
  }
  return sorted;
}

/**
 * Stable order for plugin-registered site nav links (same result regardless of
 * which plugin finishes loading first). Uses numeric `priority` when set (lower
 * = earlier), then `href`, then `text`.
 *
 * @param {unknown[] | undefined} links
 * @returns {unknown[]}
 */
export function sortSiteNavLinks(links) {
  if (!Array.isArray(links) || links.length < 2) return links || [];
  return links.slice().sort((a, b) => {
    const ap =
      a && typeof a.priority === "number" && !Number.isNaN(a.priority)
        ? a.priority
        : 1_000_000;
    const bp =
      b && typeof b.priority === "number" && !Number.isNaN(b.priority)
        ? b.priority
        : 1_000_000;
    if (ap !== bp) return ap - bp;
    const hA = String(a?.href ?? "");
    const hB = String(b?.href ?? "");
    if (hA !== hB) {
      return hA.localeCompare(hB, undefined, { numeric: true, sensitivity: "base" });
    }
    return String(a?.text ?? "").localeCompare(String(b?.text ?? ""), undefined, {
      sensitivity: "base"
    });
  });
}
