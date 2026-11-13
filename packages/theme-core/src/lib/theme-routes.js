// The pages of the theme itself (`src/routes`): the core routes `theme-core sync` writes (`/rules`, `/support`,
// `/player/[player]`, ...) and the theme's own `routes.add` pages, as canonical route patterns. The home page
// setting uses them: a custom path that is one of these pages is a page of the site even though no plugin
// registered it (doc 01 section 9).

/** Route patterns that are never a home page target: `/` itself, the posts feed and the engine's own pages. */
const EXCLUDED = new Set(["/", "/posts"]);

/**
 * `/src/routes/(theme)/player/[player]/+page.svelte` -> `/player/[player]`; `null` for the plugin catch-all
 * (`(plugin-ui)`, which matches every path) and the engine's internal pages (`/__pano...`).
 * @param {string} file
 * @returns {string | null}
 */
export function routePatternOf(file) {
  const id = file.replace(/^.*?\/src\/routes/, "").replace(/\/\+page\.svelte$/, "");

  if (id.includes("(plugin-ui)")) {
    return null;
  }

  const pattern = id.replace(/\/\([^/)]*\)/g, "") || "/";

  if (pattern.startsWith("/__pano") || EXCLUDED.has(pattern)) {
    return null;
  }

  return pattern;
}

/** @type {string[] | null} */
let cached = null;

/**
 * The theme's page patterns. Empty outside a Vite build (the engine's own `bun test` runs have no `src/routes`).
 * @returns {string[]}
 */
export function getThemeRoutePatterns() {
  if (cached) {
    return cached;
  }

  /** @type {Record<string, unknown>} */
  let files = {};

  try {
    // Vite replaces this call with the file list at build time; elsewhere `import.meta.glob` is not a function.
    files = import.meta.glob("/src/routes/**/+page.svelte");
  } catch {
    files = {};
  }

  cached = [...new Set(Object.keys(files).map(routePatternOf).filter((pattern) => pattern !== null))].sort();

  return cached;
}
