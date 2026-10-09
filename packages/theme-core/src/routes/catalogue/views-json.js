// `/__pano/views.json` (doc 02 section 7): `[{ id, kind, contract, status, states, url }]`, the input of the
// visual comparison and of the "same as before" shots. Loaded by the generated `+server.js` behind `dev`.

import { loadCatalogue } from "./catalogue.js";
import { createDeps } from "./deps.js";
import { filterRows, viewsJsonOf } from "./model.js";

/**
 * @param {{ url: URL, fetch?: typeof fetch }} event  the SvelteKit request event
 * @param {import("./catalogue.js").CatalogueDeps | null} [deps]  tests only
 */
export async function GET(event, deps = null) {
  const d = deps ?? (await createDeps(event));
  const params = event.url.searchParams;
  const rows = filterRows(await loadCatalogue(d), {
    plugin: params.get("plugin") ?? "",
    kind: params.get("kind") ?? "",
    status: params.get("status") ?? "",
  });

  return new Response(JSON.stringify(viewsJsonOf(rows, event.url.origin), null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
