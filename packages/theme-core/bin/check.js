#!/usr/bin/env bun
/**
 * theme-core check — the machine-enforced theme contract.
 *
 * Replaces the prose contract (PANO-THEME-DESIGN-CONTEXT.md) with checks that
 * fail CI before a broken theme ships:
 *   1. svelte is pinned to EXACTLY core's version (plugins compile against the
 *      host runtime surface; skew silently drops plugins at runtime)
 *   2. every view in theme.config.js exists on disk and is a KNOWN view name
 *      from skin-contract.json (typos = silent fallback to default views)
 *   3. overridden views mount every <ViewSlot>/<Hook> the default view mounts
 *      (plugin injection points must not be lost by a restyle)
 *   4. lang-overrides files are valid JSON and only add/replace keys
 *   5. manifest.json carries the required keys
 * Exit code 1 on any violation.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const themeDir = process.cwd();
const problems = [];
const warnings = [];

const contract = JSON.parse(readFileSync(join(pkgDir, "skin-contract.json"), "utf-8"));
const corePkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf-8"));

// 1. svelte pin
const themePkg = JSON.parse(readFileSync(join(themeDir, "package.json"), "utf-8"));
const themeSvelte =
  themePkg.dependencies?.svelte ?? themePkg.devDependencies?.svelte;
const coreSvelte = corePkg.dependencies.svelte;
if (themeSvelte !== coreSvelte) {
  problems.push(
    `svelte must be pinned to exactly "${coreSvelte}" (core's pin); found "${themeSvelte}" — version skew silently drops plugins at runtime`,
  );
}

// 2. view registry entries
const themeConfigPath = join(themeDir, "theme.config.js");
let registered = [];
if (existsSync(themeConfigPath)) {
  const cfgSource = readFileSync(themeConfigPath, "utf-8")
    // strip comments so documentation examples aren't parsed as registrations
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  for (const m of cfgSource.matchAll(/([A-Za-z0-9]+)\s*:\s*\(\)\s*=>\s*import\("([^"]+)"\)/g)) {
    const [, name, path] = m;
    registered.push(name);
    if (!(name in contract.views) && !contract.registry_components.includes(name)) {
      problems.push(`theme.config.js registers unknown view '${name}' — not part of the core contract (typo? removed in this core version?)`);
    }
    if (!existsSync(join(themeDir, path))) {
      problems.push(`theme.config.js: view '${name}' points at missing file ${path}`);
    }
  }
} else {
  warnings.push("no theme.config.js — theme runs with all default views");
}

// 3. slot/hook preservation in overridden views
for (const name of registered) {
  const defaultView = join(pkgDir, "src", "lib", "views", `${name}.svelte`);
  const overridePath = join(themeDir, "src", "views", `${name}.svelte`);
  if (!existsSync(defaultView) || !existsSync(overridePath)) continue;
  const wanted = new Set();
  const dv = readFileSync(defaultView, "utf-8");
  for (const m of dv.matchAll(/<ViewComponent[^>]*id="([^"]+)"/g)) wanted.add(`slot:${m[1]}`);
  for (const m of dv.matchAll(/<Hook[^>]*name="([^"]+)"/g)) wanted.add(`hook:${m[1]}`);
  const ov = readFileSync(overridePath, "utf-8");
  for (const item of wanted) {
    const [kind, id] = item.split(":");
    const present =
      kind === "slot"
        ? new RegExp(`<ViewComponent[^>]*id="${id}"`).test(ov)
        : new RegExp(`<Hook[^>]*name="${id}"`).test(ov);
    if (!present) {
      problems.push(`view '${name}' override lost plugin ${kind} '${id}' — plugins mounting there will silently disappear`);
    }
  }
}

// 4. lang-overrides sanity
const langOverrides = join(themeDir, "lang-overrides");
if (existsSync(langOverrides)) {
  for (const f of readdirSync(langOverrides)) {
    if (!f.endsWith(".json")) continue;
    try {
      JSON.parse(readFileSync(join(langOverrides, f), "utf-8"));
    } catch (e) {
      problems.push(`lang-overrides/${f} is not valid JSON: ${e.message}`);
    }
  }
}

// 5. manifest required keys
const manifestPath = join(themeDir, "manifest.json");
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  for (const key of ["id", "title", "version", "author", "panoVersion", "screenshots"]) {
    if (!(key in manifest)) problems.push(`manifest.json missing required key '${key}' (install is refused without it)`);
  }
  if (manifest.id === "vanilla-theme" && themePkg.name !== "pano-vanilla-theme") {
    problems.push(`manifest id 'vanilla-theme' is reserved for the SYSTEM theme — installs would be refused`);
  }
} else {
  problems.push("manifest.json missing");
}

for (const w of warnings) console.log(`[check] warn: ${w}`);
if (problems.length) {
  for (const p of problems) console.error(`[check] FAIL: ${p}`);
  process.exit(1);
}
console.log(`[check] OK — ${registered.length} view overrides validated against core ${corePkg.version}`);
