import fs from "fs";
import path from "path";

// plugins/<pluginId>/ is shared with the backend: it is also the plugin's data folder
// (config.conf, secret.key, ...). The UI engine may only touch what it writes itself.
export const UI_OWNED_ENTRIES = ["client", "server", "manifest.json"];

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

/** Replaces the UI-owned entries in pluginFolder with those of stagingDir, keeping all other files. */
export function replacePluginUiFiles(stagingDir, pluginFolder) {
  fs.mkdirSync(pluginFolder, { recursive: true });

  for (const entry of UI_OWNED_ENTRIES) {
    const target = path.join(pluginFolder, entry);
    fs.rmSync(target, { recursive: true, force: true });

    const source = path.join(stagingDir, entry);
    if (fs.existsSync(source)) fs.renameSync(source, target);
  }

  fs.rmSync(stagingDir, { recursive: true, force: true });
}
