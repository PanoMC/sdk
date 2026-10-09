import fs from "fs";
import path from "path";

// plugins/<pluginId>/ is shared with the backend: it is also the plugin's data folder
// (config.conf, secret.key, ...). The UI engine may only touch what it writes itself.
export const UI_OWNED_ENTRIES = [
  "client",
  "server",
  "manifest.json",
  "contract",
  "pano-plugin.json",
  "controllers",
  "samples",
];

export const PACKAGE_FILE_NAME = "pano-plugin.json";

/**
 * Reads the package index (pano-plugin.json) of a plugin folder.
 * A missing or unreadable file means an old plugin without a package: returns null.
 * @param {string} pluginFolder
 * @returns {{ namespace?: string, styles?: any, views?: any, package: object } | null}
 */
export function readPluginPackage(pluginFolder) {
  let json;
  try {
    json = JSON.parse(fs.readFileSync(path.join(pluginFolder, PACKAGE_FILE_NAME), "utf8"));
  } catch {
    return null;
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const out = { package: json };
  if (typeof json.namespace === "string" && json.namespace) out.namespace = json.namespace;
  if (json.styles !== undefined) out.styles = json.styles;
  if (json.views !== undefined) out.views = json.views;
  return out;
}

/** Removes only the UI-owned entries of a plugin folder, then the folder itself if it is empty. */
export function removePluginUiFiles(pluginFolder) {
  for (const entry of UI_OWNED_ENTRIES) {
    fs.rmSync(path.join(pluginFolder, entry), { recursive: true, force: true });
  }

  try {
    fs.rmdirSync(pluginFolder); // only succeeds when empty
  } catch {
    // missing or holds foreign files (plugin data) - leave it alone
  }
}

/** True when both paths hold the same file, or the same tree of files with the same bytes. */
export function sameContent(a, b) {
  if (!fs.existsSync(a) || !fs.existsSync(b)) return false;

  const statA = fs.statSync(a);
  const statB = fs.statSync(b);

  if (statA.isDirectory() !== statB.isDirectory()) return false;

  if (!statA.isDirectory()) {
    return statA.size === statB.size && fs.readFileSync(a).equals(fs.readFileSync(b));
  }

  const namesA = fs.readdirSync(a).sort();
  const namesB = fs.readdirSync(b).sort();

  if (namesA.length !== namesB.length || namesA.some((name, i) => name !== namesB[i])) return false;

  return namesA.every((name) => sameContent(path.join(a, name), path.join(b, name)));
}

/**
 * Replaces the UI-owned entries in pluginFolder with those of stagingDir, keeping all other files.
 *
 * An entry whose content did not change is left untouched on disk. Development mode downloads every
 * plugin UI again on each server render; rewriting identical files made the dev server's file watcher
 * reload the page right after it had loaded (a blank flash after every refresh).
 */
export function replacePluginUiFiles(stagingDir, pluginFolder) {
  fs.mkdirSync(pluginFolder, { recursive: true });

  for (const entry of UI_OWNED_ENTRIES) {
    const target = path.join(pluginFolder, entry);
    const source = path.join(stagingDir, entry);

    if (sameContent(source, target)) continue;

    fs.rmSync(target, { recursive: true, force: true });

    if (fs.existsSync(source)) fs.renameSync(source, target);
  }

  fs.rmSync(stagingDir, { recursive: true, force: true });
}
