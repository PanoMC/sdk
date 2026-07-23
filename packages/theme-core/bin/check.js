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
 *   6. settingsSchema (theme.config.js) is shape-valid, appends only, puts no
 *      key in a different tab than the base does, and its defaultTab exists
 * Exit code 1 on any violation.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
    // hook ids themselves contain ':' (e.g. "page:top") — split on the FIRST
    // colon only.
    const sep = item.indexOf(":");
    const kind = item.slice(0, sep);
    const id = item.slice(sep + 1);
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

// 6. settings-schema extension (theme.config.js → settingsSchema)
// Imported (not regex-scanned): the schema is a nested object literal, and the
// view thunks stay lazy, so importing the config runs no Svelte code.
if (existsSync(themeConfigPath) && contract.settings_tabs) {
  let settingsSchema;
  try {
    const mod = await import(pathToFileURL(themeConfigPath).href);
    settingsSchema = (mod.default ?? mod)?.settingsSchema ?? null;
  } catch (e) {
    problems.push(`theme.config.js could not be imported to validate settingsSchema: ${e.message}`);
    settingsSchema = null;
  }

  if (settingsSchema != null) {
    if (typeof settingsSchema !== "object" || Array.isArray(settingsSchema)) {
      problems.push("theme.config.js: settingsSchema must be an object ({ tabs?, defaultTab? })");
    } else {
      // base tab → keys, dropping the "_note" doc string (non-array values)
      const baseTabs = {};
      for (const tab in contract.settings_tabs) {
        if (Array.isArray(contract.settings_tabs[tab])) baseTabs[tab] = contract.settings_tabs[tab];
      }

      // key → the single tab it may live in; base first, extension appends.
      // A key mapped to two different tabs is a save conflict (save/reset are
      // per-tab), so cross-tab duplicates FAIL; same-tab duplicates just dedupe.
      const keyToTab = {};
      for (const tab in baseTabs) for (const key of baseTabs[tab]) keyToTab[key] = tab;
      const tabSet = new Set(Object.keys(baseTabs));

      const extTabs = settingsSchema.tabs;
      if (extTabs != null) {
        if (typeof extTabs !== "object" || Array.isArray(extTabs)) {
          problems.push("theme.config.js: settingsSchema.tabs must be an object mapping tabId → string[]");
        } else {
          for (const tab in extTabs) {
            tabSet.add(tab);
            const keys = extTabs[tab];
            if (!Array.isArray(keys) || keys.some((k) => typeof k !== "string")) {
              problems.push(`theme.config.js: settingsSchema.tabs['${tab}'] must be an array of setting-key strings`);
              continue;
            }
            for (const key of keys) {
              const owner = keyToTab[key];
              if (owner === undefined) keyToTab[key] = tab;
              else if (owner !== tab)
                problems.push(`settingsSchema key '${key}' is declared in tab '${tab}' but already belongs to tab '${owner}' — the same key in two tabs makes save/reset ambiguous`);
              // owner === tab → harmless duplicate, deduped at runtime
            }
          }
        }
      }

      if (settingsSchema.defaultTab != null) {
        if (typeof settingsSchema.defaultTab !== "string") {
          problems.push("theme.config.js: settingsSchema.defaultTab must be a string");
        } else if (!tabSet.has(settingsSchema.defaultTab)) {
          problems.push(`settingsSchema.defaultTab '${settingsSchema.defaultTab}' is not a known tab (base tabs + your settingsSchema.tabs) — the settings page would open on an empty tab`);
        }
      }
    }
  }
}

for (const w of warnings) console.log(`[check] warn: ${w}`);
if (problems.length) {
  for (const p of problems) console.error(`[check] FAIL: ${p}`);
  process.exit(1);
}
console.log(`[check] OK — ${registered.length} view overrides validated against core ${corePkg.version}`);
