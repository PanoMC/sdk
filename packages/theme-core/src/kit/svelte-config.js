/**
 * Factory for a theme's svelte.config.js (plain-node context — no vite aliases,
 * no $app imports here). A theme's config becomes:
 *
 *   import { createSvelteConfig } from "@panomc/theme-core/kit/svelte-config";
 *   export default createSvelteConfig(import.meta.url);
 */
import { readFileSync } from "node:fs";
import { importFromTheme } from "./resolve.js";

/**
 * @param {string} themeMetaUrl  the theme's `import.meta.url` (locates its package.json)
 * @param {object} [overrides]  optional kit config overrides merged shallowly into `kit`
 *
 * Async on purpose (consumer: `export default await createSvelteConfig(...)`):
 * the preprocessor and adapter are imported from the THEME's node_modules so
 * only one toolchain instance exists (see kit/resolve.js).
 */
export async function createSvelteConfig(themeMetaUrl, overrides = {}) {
  const [preprocessMod, adapterMod] = await Promise.all([
    importFromTheme("svelte-preprocess"),
    importFromTheme("@sveltejs/adapter-node"),
  ]);
  const SveltePreprocess = preprocessMod.default ?? preprocessMod;
  const NodeAdapter = adapterMod.default ?? adapterMod;

  const pkg = JSON.parse(
    readFileSync(new URL("./package.json", themeMetaUrl), "utf-8"),
  );

  /** @type {import('@sveltejs/kit').Config} */
  const config = {
    kit: {
      adapter: NodeAdapter(),
      version: {
        // SvelteKit defaults version.name to Date.now(), which leaks into
        // /_app/version.json and makes every build differ byte-for-byte. The
        // theme zip's sha256 IS the premium license identity, so builds must
        // be reproducible: pin the version to the theme's package version.
        name: pkg.version,
      },
      ...overrides,
    },

    preprocess: SveltePreprocess({
      scss: {
        api: "modern-compiler",
        quietDeps: true,
        silenceDeprecations: [
          "mixed-decls",
          "color-functions",
          "global-builtin",
          "import",
        ],
      },
    }),

    onwarn: (warning, handler) => {
      if (warning.code.startsWith("a11y-")) {
        return;
      }

      if (warning.code === "vite-plugin-svelte-preprocess-many-dependencies") {
        return;
      }

      console.log(warning.code);

      handler(warning);
    },
  };

  return config;
}
