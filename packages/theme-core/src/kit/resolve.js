/**
 * Theme-first module resolution for plain-node contexts (svelte.config.js /
 * vite.config.js load time).
 *
 * The core package is symlinked (file:/link:) or installed under the theme's
 * node_modules; node resolves core's own imports from core's REAL location, so
 * naively importing "@sveltejs/kit/vite" here could load a DIFFERENT toolchain
 * copy than the one the theme's build actually runs. These helpers resolve the
 * requested package from the THEME's node_modules first and only fall back to
 * core's own dependency tree.
 *
 * require.resolve can't be used: kit/adapter-node are ESM-only (no "require"
 * export condition), so the exports map is read manually.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

function pickCondition(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    for (const key of ["svelte", "import", "default", "node"]) {
      if (key in entry) {
        const picked = pickCondition(entry[key]);
        if (picked) return picked;
      }
    }
  }
  return null;
}

/**
 * Resolve `pkgName` + `subpath` (e.g. "@sveltejs/kit", "./vite") from
 * `baseDir`'s node_modules via the package's exports map, or `main`/`module`
 * fields for legacy packages.
 * @returns {string|null} absolute file path, or null if not found
 */
export function resolveFrom(baseDir, pkgName, subpath = ".") {
  const pkgDir = join(baseDir, "node_modules", ...pkgName.split("/"));
  const pkgJsonPath = join(pkgDir, "package.json");
  if (!existsSync(pkgJsonPath)) return null;

  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));

  if (pkg.exports) {
    const entry = pkg.exports[subpath] ?? (subpath === "." ? pkg.exports : null);
    const target = pickCondition(entry);
    return target ? join(pkgDir, target) : null;
  }

  if (subpath === ".") {
    const target = pkg.module ?? pkg.main ?? "index.js";
    return join(pkgDir, target);
  }

  return join(pkgDir, subpath);
}

/**
 * Import a toolchain module, preferring the theme's own copy (process.cwd())
 * over core's dependency tree, so exactly ONE toolchain instance drives the
 * build.
 */
export async function importFromTheme(pkgName, subpath = ".") {
  const resolved = resolveFrom(process.cwd(), pkgName, subpath);
  if (resolved) {
    return import(pathToFileURL(resolved).href);
  }
  // Fallback: core's own tree (e.g. running core's tests inside this repo).
  return import(subpath === "." ? pkgName : pkgName + subpath.slice(1));
}
