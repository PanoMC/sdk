/**
 * Factory for a theme's vite.config.js (plain-node context). A theme's config
 * becomes:
 *
 *   import { createViteConfig } from "@panomc/theme-core/kit/vite-config";
 *   export default createViteConfig();
 *
 * Owning this file in core kills the config-drift class (blocky/frost's stale
 * vite majors, hand-edited proxy blocks, missing dedupe entries): a toolchain
 * fix ships as a core bump.
 */
import { defineConfig, loadEnv } from "vite";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { importFromTheme } from "./resolve.js";
import { scanThemeMeta, renderThemeMetaModule } from "./theme-meta.js";
import { loadThemeConfig, pullContracts, writeCoreMeta } from "../../bin/contracts.js";

const require = createRequire(import.meta.url);

function copyFolderPlugin(folder) {
  let outDir = "";

  return {
    name: `copy-${folder}-folder`,
    apply: "build", // Run only during build
    configResolved() {
      outDir = "build/";
    },
    async closeBundle() {
      const srcDir = path.resolve(process.cwd(), folder);
      const destDir = path.resolve(process.cwd(), outDir, folder);

      if (!fs.existsSync(srcDir)) {
        console.warn(`Source folder "${folder}" not found at: ${srcDir}`);
        return;
      }

      try {
        await fs.promises.cp(srcDir, destDir, { recursive: true });
        console.log(`Copied "${folder}" folder from ${srcDir} to ${destDir}`);
      } catch (error) {
        console.error(`Error copying "${folder}" folder:`, error);
      }
    },
  };
}

export function copyManifestPlugin(filename = "manifest.json") {
  let outDir = "";

  return {
    name: "copy-manifest-json",
    apply: "build",
    configResolved() {
      outDir = "build/";
    },
    async closeBundle() {
      const srcPath = path.resolve(process.cwd(), filename);
      const destPath = path.resolve(process.cwd(), outDir, filename);

      if (!fs.existsSync(srcPath)) {
        console.warn(`Manifest file not found at: ${srcPath}`);
        return;
      }

      try {
        await fs.promises.writeFile(destPath, await manifestWithApiLevel(srcPath));
        console.log(`Copied manifest from ${srcPath} to ${destPath}`);
      } catch (err) {
        console.error("Failed to copy manifest.json:", err);
      }
    },
  };
}

/**
 * The manifest as it goes into build/: `apiLevel` is stamped from the engine's package.json
 * (`pano.apiLevel`, doc 04 section 7) unless the theme's own manifest sets one. A manifest that is
 * not valid JSON is copied byte for byte.
 */
async function manifestWithApiLevel(srcPath) {
  const raw = await fs.promises.readFile(srcPath);

  let manifest;
  try {
    manifest = JSON.parse(raw.toString("utf-8"));
  } catch {
    return raw;
  }

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || "apiLevel" in manifest) return raw;

  const apiLevel = require("@panomc/theme-core/package.json").pano?.apiLevel;
  if (!Number.isInteger(apiLevel)) return raw;

  return JSON.stringify({ ...manifest, apiLevel }, null, 2) + "\n";
}

export function copyCoreMetaPlugin() {
  // core-meta.json is what the platform reads about a theme (overrides, engine, supports, home, routes,
  // controllers, urls, settingsSchema; doc 01 section 7) plus the author's own keys (tier, baseTheme, ...)
  // and the coreVersion stamped here. It is generated from theme.config.js on every build, so it cannot be
  // stale; `finalize-fingerprint.js` runs after this and covers it. See docs/P0-SPIKE.md section 6.
  let outDir = "";

  return {
    name: "copy-core-meta-json",
    apply: "build",
    configResolved() {
      outDir = "build/";
    },
    async closeBundle() {
      const themeDir = process.cwd();
      const destPath = path.resolve(themeDir, outDir, "core-meta.json");
      const corePkg = require("@panomc/theme-core/package.json");

      let configFailed = false;
      const config = await loadThemeConfig(themeDir, (error) => {
        configFailed = true;
        console.warn(`[core-meta] could not import theme.config.js: ${error?.message ?? error}`);
      });

      if (configFailed) {
        // keep the committed file rather than write metadata from an empty config
        const srcPath = path.resolve(themeDir, "core-meta.json");
        if (!fs.existsSync(srcPath)) return;
        const meta = JSON.parse(await fs.promises.readFile(srcPath, "utf-8"));
        meta.coreVersion = corePkg.version;
        await fs.promises.writeFile(destPath, JSON.stringify(meta, null, 2));
        return;
      }

      writeCoreMeta({ themeDir, config, outFile: destPath, extra: { coreVersion: corePkg.version } });
      console.log(`Wrote core-meta.json (coreVersion ${corePkg.version})`);
    },
  };
}

/**
 * A short digest of the installed @panomc/sdk and @panomc/theme-core files (path, size, mtime).
 *
 * `vite dev` serves files under node_modules with `?v=<browserHash>` and `Cache-Control: immutable`.
 * That hash is built from the lockfile and the config only, so it stays the same when `bun install`
 * refreshes these two `file:` packages from the theme-core submodule: the browser then keeps the old
 * files for a year and the app dies on a missing export. The digest goes into a plugin NAME (plugin
 * names are part of vite's config hash), so new package content always gives a new `?v=`.
 */
function corePackagesDigest() {
  const hash = createHash("sha1");

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1))) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;

      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const stat = fs.statSync(full);
        hash.update(`${full}:${stat.size}:${Math.floor(stat.mtimeMs)}\n`);
      }
    }
  };

  for (const name of ["@panomc/sdk", "@panomc/theme-core"]) {
    try {
      walk(path.dirname(require.resolve(`${name}/package.json`)));
    } catch {
      // not installed in this consumer: nothing to track
    }
  }

  return hash.digest("hex").slice(0, 12);
}

function corePackagesCacheKeyPlugin() {
  return { name: `pano-core-packages-${corePackagesDigest()}`, apply: "serve" };
}

const THEME_META_ID = "virtual:pano-theme-meta";
const THEME_META_RESOLVED = "\0" + THEME_META_ID;

/**
 * Serves `virtual:pano-theme-meta` (doc 01 section 4): the blocks, slots and claims found by scanning
 * the theme's overrides, added route pages and home pages (see theme-meta.js). The scanned files and
 * theme.config.js are watched, so an edit rebuilds the module.
 * @param {{ themeDir?: string }} [options]
 */
export function panoThemeMeta(options = {}) {
  const themeDir = options.themeDir ?? process.cwd();
  const configPath = path.join(themeDir, "theme.config.js");
  /** @type {Set<string>} */
  let watched = new Set();

  async function loadConfig() {
    if (!fs.existsSync(configPath)) return {};
    try {
      // a fresh URL every time: the module cache must not serve an old theme.config.js
      const mod = await import(`${pathToFileURL(configPath).href}?t=${Date.now()}`);
      return mod.default ?? {};
    } catch (error) {
      console.warn(`[pano-theme-meta] could not import theme.config.js: ${error?.message ?? error}`);
      return {};
    }
  }

  return {
    name: "pano-theme-meta",
    enforce: "pre",
    resolveId(id) {
      return id === THEME_META_ID ? THEME_META_RESOLVED : null;
    },
    async load(id) {
      if (id !== THEME_META_RESOLVED) return null;
      const meta = scanThemeMeta({ themeDir, config: await loadConfig() });
      watched = new Set([configPath, ...meta.files]);
      for (const file of watched) this.addWatchFile?.(file);
      return renderThemeMetaModule(meta, themeDir);
    },
    handleHotUpdate({ file, server }) {
      if (!watched.has(path.normalize(file))) return;
      const mod = server.moduleGraph.getModuleById(THEME_META_RESOLVED);
      if (mod) server.moduleGraph.invalidateModule(mod);
      server.ws.send({ type: "full-reload" });
    },
  };
}

/** Absolute path to @panomc/theme-core's src/ inside the consumer's node_modules. */
function corePackageSrc() {
  return path.dirname(require.resolve("@panomc/theme-core/package.json")) + "/src";
}

/**
 * @param {object} [opts]
 * @param {string} [opts.base]  app base path ("" for themes, "/panel" for panel-ui);
 *   drives the extra dev proxy entry and hmr path
 * @param {string[]} [opts.copyFolders]  folders copied into build/ (default lang+screenshots;
 *   panel: ["lang"])
 * @param {object} [opts.extraAliases]  additional resolve.alias entries
 * @param {string[]} [opts.extraNoExternalDev]  extra ssr.noExternal entries for dev
 * @param {string[]} [opts.extraOptimizeExclude]  extra optimizeDeps.exclude entries
 * @param {any[]} [opts.extraPlugins]  profile-specific vite plugins appended to the list
 * @param {(config: object, ctx: {command: string}) => object} [opts.finalize]
 *   last-chance escape hatch to adjust the resolved config
 */
export function createViteConfig(opts = {}) {
  const base = opts.base ?? "";
  const copyFolders = opts.copyFolders ?? ["lang", "screenshots"];
  const env = loadEnv("", process.cwd());

  return defineConfig(async ({ command }) => {
    // The kit vite plugin MUST come from the theme's own node_modules — core's
    // copy can be a different version and would drive the build with mismatched
    // $app/runtime code (see kit/resolve.js).
    const { sveltekit } = await importFromTheme("@sveltejs/kit", "./vite");

    // Every dev start refreshes plugin-contracts/ from the installed plugins and prints the views whose
    // contract changed (doc 01 section 5). Never fatal: a broken plugin folder must not stop the dev server.
    if (command === "serve") {
      try {
        pullContracts({ themeDir: process.cwd(), log: (line) => console.log(`[theme-core] ${line}`) });
      } catch (error) {
        console.warn(`[theme-core] plugin contracts were not refreshed: ${error?.message ?? error}`);
      }
    }

    const config = {
      clearScreen: false,
      plugins: [
        panoThemeMeta(),
        sveltekit(),
        // NOTE: licenses.json is generated by bin/license/finalize-fingerprint.js
        // AFTER vite build — a closeBundle plugin races adapter-node's build/
        // rewrite (SSR pass's output gets wiped by the final adapter pass).
        ...copyFolders.map((f) => copyFolderPlugin(f)),
        copyManifestPlugin(),
        copyCoreMetaPlugin(),
        corePackagesCacheKeyPlugin(),
        ...(opts.extraPlugins ?? []),
      ],
      // NOTE: The theme file-fingerprint is stamped into build/manifest.json by
      // bin/license/finalize-fingerprint.js, which the theme's `build` script runs
      // AFTER `vite build`. Doing it inside a vite plugin would race with SvelteKit's
      // adapter-node two-pass bundling (SSR + client), producing a digest that doesn't
      // cover all files.
      ssr: {
        noExternal:
          command === "build"
            ? true
            : [
                "@panomc/sdk",
                "@panomc/theme-core",
                "svelte-i18n",
                ...(opts.extraNoExternalDev ?? []),
              ],
      },
      css: {
        preprocessorOptions: {
          scss: {
            api: "modern-compiler",
            loadPaths: [
              process.cwd(),
              path.resolve(process.cwd(), "node_modules"),
            ],
            quietDeps: true,
            silenceDeprecations: [
              "color-functions",
              "global-builtin",
              "import",
            ],
          },
        },
      },
      optimizeDeps: {
        include: ["deepmerge", "svelte-i18n"],
        exclude: [
          "@panomc/sdk",
          "@panomc/theme-core",
          "svelte",
          ...(opts.extraOptimizeExclude ?? []),
        ],
      },
      server: {
        proxy: {
          // NEVER proxy /plugins here: the app itself serves plugin client
          // chunks; proxying it to the backend creates a request loop.
          "/api": env.VITE_API_URL
            ? env.VITE_API_URL.replace("/api", "")
            : "http://localhost:8088",
          ...(base
            ? {
                [`${base}/api`]: env.VITE_API_URL
                  ? env.VITE_API_URL.replace(`${base}/api`, "").replace("/api", "")
                  : "http://localhost:8088",
              }
            : {}),
        },
        allowedHosts: true,
        hmr: {
          path: base ? `${base}/` : "/",
        },
      },
      resolve: {
        alias: {
          // $pano resolves core-internal imports; it works in every
          // vite-processed context (theme code, core code, generated shims).
          "$pano": corePackageSrc(),
          "@theme-style":
            command === "serve" && process.env.VITE_DEV_UI !== "true"
              ? path.resolve(process.cwd(), "src/styles/_empty.scss")
              : path.resolve(process.cwd(), "src/styles/style.scss"),
          ...(opts.extraAliases ?? {}),
        },
        preserveSymlinks: true,
        // @sveltejs/kit is deduped so core-internal `import { error } from
        // "@sveltejs/kit"` resolves to the THEME's kit, not a second copy from
        // core's own node_modules.
        dedupe: [
          "svelte",
          "@panomc/sdk",
          "@panomc/theme-core",
          "svelte-i18n",
          "@sveltejs/kit",
          // core's own runtime deps: resolve them from the THEME's root so a
          // symlinked (file:/link:) core never drags in a second copy from its
          // own isolated store (preserveSymlinks defeats nested resolution).
          "date-fns",
          "copy-to-clipboard",
          "@jill64/universal-sanitizer",
          "mime-types",
          "tippy.js",
          "adm-zip",
        ],
      },
      build: {
        manifest: true,
        // svelte/@panomc/sdk/@panomc/theme-core are deliberately NOT externalized:
        // the host bundles its own runtime (immutable-cached under /_app/immutable),
        // and plugins reach the very same module instances through the /runtime
        // shims + the registry installed by kit/hooks-client.js.
      },
    };

    return opts.finalize ? opts.finalize(config, { command }) : config;
  });
}
