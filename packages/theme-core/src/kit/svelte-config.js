/**
 * The SvelteKit options of a theme (plain-node context — no vite aliases, no $app imports here).
 *
 * SvelteKit 3 reads its configuration from the `sveltekit()` vite plugin instead of svelte.config.js, so
 * `createViteConfig` (kit/vite-config.js) passes these options to that plugin and a theme has no svelte.config.js.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { importFromTheme } from "./resolve.js";

/**
 * @param {string} [themeDir]  the theme's folder (holds its package.json); the current directory by default
 * @param {object} [overrides]  SvelteKit options merged shallowly over the defaults (e.g. `paths`, `alias`)
 *
 * Async on purpose: the preprocessor and adapter are imported from the THEME's node_modules so only one toolchain
 * instance exists (see kit/resolve.js).
 */
export async function createKitOptions(themeDir = process.cwd(), overrides = {}) {
  const [preprocessMod, adapterMod] = await Promise.all([
    importFromTheme("svelte-preprocess"),
    importFromTheme("@sveltejs/adapter-node"),
  ]);
  const SveltePreprocess = preprocessMod.default ?? preprocessMod;
  const NodeAdapter = adapterMod.default ?? adapterMod;

  const pkg = JSON.parse(readFileSync(path.join(themeDir, "package.json"), "utf-8"));

  return {
    adapter: NodeAdapter(),
    version: {
      // SvelteKit defaults version.name to Date.now(), which leaks into
      // /_app/version.json and makes every build differ byte-for-byte. The
      // theme zip's sha256 IS the premium license identity, so builds must
      // be reproducible: pin the version to the theme's package version.
      name: pkg.version,
    },
    ...overrides,
    // `$contracts` -> plugin-contracts/ (the snapshots `theme-core contracts pull` keeps, doc 02 section 5.3):
    // /** @type {import('$contracts/market/controllers.types.js').Controllers['market/cart']} */
    alias: { $contracts: "plugin-contracts", ...(overrides.alias ?? {}) },

    preprocess: SveltePreprocess({
      // Svelte 5 strips TypeScript itself; SvelteKit 3's own components are `lang="ts"` and the typescript
      // transformer would require the typescript package in every theme.
      typescript: false,
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
      // Svelte 5 names them a11y_*, Svelte 4 named them a11y-*
      if (warning.code.startsWith("a11y")) {
        return;
      }

      if (warning.code === "vite-plugin-svelte-preprocess-many-dependencies") {
        return;
      }

      console.log(warning.code);

      handler(warning);
    },
  };
}

/**
 * The svelte.config.js factory of engines built for SvelteKit 2. SvelteKit 3 does not read svelte.config.js: delete
 * the file, the options come from `createViteConfig` in vite.config.js (`kit` option for overrides).
 */
export async function createSvelteConfig() {
  throw new Error(
    "SvelteKit 3 does not read svelte.config.js. Delete it: createViteConfig() in vite.config.js now passes the " +
      "SvelteKit options to the sveltekit() plugin (put overrides such as `paths` under its `kit` option).",
  );
}
