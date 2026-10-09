// `/__pano/views` (doc 02 section 7): the list of every view the theme can show. Loaded by the generated
// `+page.js` behind `dev`; it returns `{ component, ... }` and the page only renders the component.

import { loadCatalogue } from "./catalogue.js";
import { createDeps } from "./deps.js";
import { filterOptions, filterRows } from "./model.js";

/** The three filters of the list, read from the query string. */
export function filtersFrom(searchParams) {
  return {
    plugin: searchParams.get("plugin") ?? "",
    kind: searchParams.get("kind") ?? "",
    status: searchParams.get("status") ?? "",
  };
}

/**
 * @param {{ url: URL, fetch?: typeof fetch }} event  the SvelteKit load event
 * @param {import("./catalogue.js").CatalogueDeps & { components?: { List: () => Promise<any> } } | null} [deps]  tests only
 */
export async function load(event, deps = null) {
  const d = deps ?? (await createDeps(event));
  const all = await loadCatalogue(d);
  const filters = filtersFrom(event.url.searchParams);
  const rows = filterRows(all, filters);
  const components = d.components ?? { List: () => import("./List.svelte") };

  return {
    component: (await components.List()).default,
    rows,
    total: all.length,
    filters,
    options: filterOptions(all),
    // one place for the colour of the status badge
    issues: all.flatMap((row) => row.issues),
  };
}
