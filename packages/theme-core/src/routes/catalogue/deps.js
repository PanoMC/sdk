// View catalogue, the real dependencies of `catalogue.js` (doc 02 section 7).
//
// The catalogue runs in two places: the pages in the browser (the theme dev server, `ssr = false`) and
// `/__pano/views.json` in the theme process. A plugin's package is read over HTTP from the theme's own
// `plugins/<id>/resources/plugin-ui/...` route in the first and from `plugins/<id>/` on disk in the second.
// `$app/*` and the plugin manager are imported when `createDeps` runs, never when this file loads. The same goes for
// `node:*`: this file is bundled for the browser too, where a static `node:path` import is an externalized stub that
// throws as soon as a named import is read.

import skinContract from "../../../skin-contract.json";
import * as registry from "../../registry/index.js";
import { ENGINE_SAMPLES } from "./engineSamples.js";

const PLUGIN_UI = "resources/plugin-ui";

/** URL of a file of a plugin's package on the theme server (browser side). */
export function pluginFileUrl(base, pluginId, kind, file) {
  return `${base}/plugins/${encodeURIComponent(pluginId)}/${PLUGIN_UI}/${kind}/${file}`;
}

/**
 * Plugin packages in the browser: over the theme's `plugins/...` route.
 * @param {{ fetch: typeof fetch, base: string, pluginIds: () => Promise<string[]> }} options
 */
export function browserPluginSource({ fetch, base, pluginIds }) {
  return {
    pluginIds,
    async pluginViews(pluginId) {
      const response = await fetch(pluginFileUrl(base, pluginId, "contract", "views.json"));

      return response.ok ? response.json() : null;
    },
    async pluginSamples(pluginId) {
      // a module of the theme server, not of the bundle: the browser loads it as it is
      return import(/* @vite-ignore */ pluginFileUrl(base, pluginId, "samples", "samples.mjs"));
    },
    async readText(pluginId, path) {
      const response = await fetch(pluginFileUrl(base, pluginId, "contract", path));

      return response.ok ? response.text() : null;
    },
  };
}

/**
 * Plugin packages on the theme server: `plugins/<id>/` on disk.
 * @param {{ root?: string }} [options]
 */
export function serverPluginSource({ root = "plugins" } = {}) {
  const fs = () => import("node:fs");
  const join = (...parts) => parts.join("/");

  return {
    async pluginIds() {
      const { readdirSync, existsSync } = await fs();

      if (!existsSync(root)) return [];

      return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, "contract", "views.json")))
        .map((entry) => entry.name)
        .sort();
    },
    async pluginViews(pluginId) {
      const { readFileSync } = await fs();

      try {
        return JSON.parse(readFileSync(join(root, pluginId, "contract", "views.json"), "utf8"));
      } catch {
        return null;
      }
    },
    async pluginSamples(pluginId) {
      const { existsSync } = await fs();
      const file = join(root, pluginId, "samples", "samples.mjs");

      if (!existsSync(file)) return null;

      const { pathToFileURL } = await import("node:url");
      const { resolve } = await import("node:path");

      return import(/* @vite-ignore */ pathToFileURL(resolve(process.cwd(), file)).href);
    },
    async readText() {
      return null;
    },
  };
}

/**
 * The readable source of an engine view (`src/lib/views/HomeView.svelte`, relative to the engine package),
 * through the dev server's `?raw` import. null when the module cannot be fetched (no dev server).
 * @param {string} path
 */
export async function readEngineSource(path) {
  try {
    const url = new URL(`../../../${path}?raw`, import.meta.url).href;

    return (await import(/* @vite-ignore */ url)).default ?? null;
  } catch {
    return null;
  }
}

/**
 * The dependencies of `loadCatalogue` in this process.
 * @param {{ fetch?: typeof fetch, parent?: () => Promise<any> }} [event]  the SvelteKit load event (its `fetch` is the one to use)
 */
export async function createDeps(event) {
  const { browser } = await import("$app/environment");

  /** @type {ReturnType<typeof browserPluginSource>} */
  let source;
  if (browser) {
    // The installed plugins are known after the root layout load has initialised them. A page load runs beside its
    // layouts unless it waits, and read too early the list is empty: every plugin view was "No view named ...".
    await event?.parent?.().catch(() => {});

    const { base } = await import("$app/paths");
    const { get } = await import("svelte/store");

    source = browserPluginSource({
      fetch: event?.fetch ?? fetch,
      base,
      pluginIds: async () => {
        const { plugins } = await import("$pano/lib/PluginManager.js");

        return Object.keys(get(plugins) ?? {});
      },
    });
  } else {
    source = serverPluginSource();
  }

  return {
    skinContract,
    engineSamples: ENGINE_SAMPLES,
    registry,
    ...source,
    readEngineSource,
    components: {
      List: () => import("./List.svelte"),
      Stage: () => import("./Stage.svelte"),
    },
    browser,
  };
}
