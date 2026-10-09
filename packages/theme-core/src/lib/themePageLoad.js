// Load function of a page the theme adds itself (`routes.add`, `home.options.<id>.page`), doc 01
// section 9. The generated `+page.js` is:
//
//   import * as mod from "<page file>";
//   export const load = themePageLoad("route:/staff-team", mod);
//
// The result is the page's own `load` output plus the data of the `<PluginBlock>` placements the
// theme found in the page and in the views it renders (`block:<key>` entries, the same keys
// `loadView` gives an engine page), so those blocks are rendered on the server.
import { loadView } from "../registry/index.js";

/**
 * @param {string} key  `route:<path>` or `home:<id>`: the key the theme-meta scan stored the refs under
 * @param {any} mod  the page module (`import * as mod`), or a function returning it (or its promise)
 * @returns {(event: any) => Promise<Record<string, any>>}
 */
export function themePageLoad(key, mod) {
  return async function load(event) {
    const resolved = typeof mod === "function" ? await mod() : await mod;
    const own = typeof resolved?.load === "function" ? await resolved.load(event) : undefined;

    const closure = await loadView(event, key).catch((e) => {
      console.warn(`[theme-core] could not load the blocks of '${key}'`, e);
      return {};
    });

    const blocks = {};

    for (const [name, value] of Object.entries(closure ?? {})) {
      if (name.startsWith("block:")) {
        blocks[name] = value;
      }
    }

    // The page's own keys win over a block key (a block key has a `block:` prefix, so a clash is unlikely).
    return { ...blocks, ...(own && typeof own === "object" ? own : {}) };
  };
}
