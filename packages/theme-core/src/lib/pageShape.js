// The one list shape of the public API (doc 04 section 4): `{ items, page: { number, size, totalItems, totalPages } }`
// plus extra top-level keys. The services below turn it into the page data the views have always read
// (`posts` + `postCount`, `tickets` + `ticketCount`, a numeric `page`, `totalPages`).

/**
 * @typedef {{ number: number, size: number, totalItems: number, totalPages: number }} PageInfo
 */

/**
 * Splits a list body into its items, page numbers and the extra keys; an error body comes back untouched.
 * @param {any} body answer of a list endpoint
 * @returns {{ failed: true, body: any } | { failed: false, items: any[], count: number, number: number, totalPages: number, rest: Record<string, any> }}
 */
export function readPage(body) {
  if (!body || body.error) {
    return { failed: true, body };
  }

  const { items, page, ...rest } = body;
  const info = /** @type {Partial<PageInfo>} */ (page && typeof page === "object" ? page : {});
  const list = Array.isArray(items) ? items : [];
  const count = info.totalItems ?? list.length;

  return {
    failed: false,
    items: list,
    count,
    number: info.number ?? 1,
    // an empty list still has one (empty) page to show, as it always had
    totalPages: Math.max(1, info.totalPages ?? 1),
    rest,
  };
}
