import fs from "fs";

import { browser, dev } from "$app/environment";
import { get, writable } from "svelte/store";
import ApiUtil from "$lib/api.util.js";
import { base } from "$app/paths";

import { init as initPluginAPI, panoApiClient, panoApiServer } from "$lib/PluginAPI.js";
import { PanoPlugin } from "@panomc/sdk";
import { findMatch } from "./RouteMatcher.js";

export let registeredPages = {};

export { findMatch };

let path, url, admZip;

let serverSidePrepared = false;
let serverSideInitialized = false;
let lastProcessedBackendHash = null;
let lastProcessedFrontendHash = null;
let clientSideInitialized = false;
let clientSidePluginHash = null;

// In-flight preparePlugins promise. Filesystem mutations in verifyPlugins are not safe to
// interleave between concurrent SSR requests; concurrent runs were producing partial states
// where some files were being deleted while others were being read.
let preparePluginsInflight = null;



if (!browser) {
  const pathStuff = await import('path');
  const urlStuff = await import('url');
  const admZipStuff = await import('adm-zip');

  path = pathStuff;
  url = urlStuff;
  admZip = admZipStuff.default;
}

export const plugins = writable({});

const pluginsFolder = 'plugins';
const manifestFileName = 'manifest.json';
const pluginUiZipFileName = 'plugin-ui.zip';

function log(message) {
  if (dev) console.log(`[Plugin Manager] ${message}`);
}

function error(message) {
  if (dev) console.error(`[Plugin Manager] ${message}`);
}

function debug(message) {
  if (dev) console.debug(`[Plugin Manager] ${message}`);
}

function createPluginsFolder() {
  if (!fs.existsSync(pluginsFolder)) {
    fs.mkdirSync(pluginsFolder, { recursive: true });
  }
}

function isDirectory(path) {
  try {
    return fs.statSync(path).isDirectory();
  } catch (error) {
    return false;
  }
}

function isDirectoryEmpty(directoryPath) {
  try {
    const items = fs.readdirSync(directoryPath);
    return items.length === 0;
  } catch (error) {
    return false;
  }
}

async function downloadAndExtractZip(file, outputDir) {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const zip = new admZip(buffer, {});

  zip.extractAllTo(outputDir, true);
}

function readPluginsFromFolder(siteInfo) {
  const readPluginsFolder = fs.readdirSync(pluginsFolder);

  const plugins = {};

  readPluginsFolder
    .filter((pluginId) => isDirectory(path.join(pluginsFolder, pluginId)))
    .forEach((pluginId) => {
      try {
        const manifestFile = fs.readFileSync(path.join(pluginsFolder, pluginId, manifestFileName), {
          encoding: 'utf8',
          flag: 'r',
        });

        plugins[pluginId] = JSON.parse(manifestFile);
      } catch (_) {
        // if (siteInfo.developmentMode) {
        //   plugins[pluginId] = {
        //     version: 'dev-build',
        //     uiHash: 'dev-build',
        //   };
        // }
      }
    });

  return plugins;
}

async function downloadPluginUiZip(pluginId) {
  return await ApiUtil.get({
    path: `/api/plugins/${pluginId}/resources/${pluginUiZipFileName}`,
    blob: true,
  });
}

async function verifyPlugins(pluginsInFolder, siteInfo) {
  // this method is fully BFF (backend for front-end) SSR

  const pluginsInfo = siteInfo.plugins;
  const pluginIdInFolderList = Object.keys(pluginsInFolder);

  pluginIdInFolderList.forEach((pluginId) => {
    // remove plugin folder if not in developmentMode & pluginsInfo (BE) doesn't have
    if (siteInfo.developmentMode || !pluginsInfo[pluginId]) {
      log(`Removing '${pluginId}' folder...`);

      fs.rmSync(path.join(pluginsFolder, pluginId, 'server'), {
        recursive: true,
        force: true,
      });
      fs.rmSync(path.join(pluginsFolder, pluginId, 'client'), {
        recursive: true,
        force: true,
      });
      fs.rmSync(path.join(pluginsFolder, pluginId, manifestFileName), {
        recursive: true,
        force: true,
      });

      if (isDirectoryEmpty(path.join(pluginsFolder, pluginId))) {
        fs.rmSync(path.join(pluginsFolder, pluginId), {
          recursive: true,
          force: true,
        });
      }

      plugins.update((p) => {
        delete p[pluginId];
        return p;
      });
      return;
    }

    // install plugins in folder
    plugins.update((p) => {
      p[pluginId] = pluginsInFolder[pluginId];
      return p;
    });
  });

  // Fix broken plugin folder, if it doesn't contain server or client
  pluginIdInFolderList.forEach((pluginId) => {
    const pluginFolder = path.join(pluginsFolder, pluginId);
    const serverIsDirectory = isDirectory(path.join(pluginFolder, 'server'));
    const clientIsDirectory = isDirectory(path.join(pluginFolder, 'client'));

    let remove;

    if (serverIsDirectory && !clientIsDirectory) {
      fs.rmSync(path.join(pluginFolder, 'server'), {
        recursive: true,
        force: true,
      });
      remove = true;
    }

    if (clientIsDirectory && !serverIsDirectory) {
      fs.rmSync(path.join(pluginFolder, 'client'), {
        recursive: true,
        force: true,
      });
      remove = true;
    }

    if (remove) {
      log(`Fixing broken '${pluginId}' folder...`);
      delete pluginsInFolder[pluginId];
      plugins.update((p) => {
        delete p[pluginId];
        return p;
      });
      delete pluginIdInFolderList[pluginIdInFolderList.indexOf(pluginId)];

      fs.rmSync(path.join(pluginFolder, manifestFileName), {
        recursive: true,
        force: true,
      });

      if (isDirectoryEmpty(path.join(pluginFolder))) {
        fs.rmSync(path.join(pluginFolder), {
          recursive: true,
          force: true,
        });
      }
    }

    if (
      !isDirectory(path.join(pluginFolder, 'server')) &&
      !isDirectory(path.join(pluginFolder, 'client')) &&
      fs.existsSync(path.join(pluginFolder, manifestFileName))
    ) {
      fs.rmSync(path.join(pluginFolder, manifestFileName), {
        recursive: true,
        force: true,
      });
    }
  });

  // Remove installed plugin if not in directory
  Object.keys(get(plugins))
    .filter((pluginId) => !pluginIdInFolderList.includes(pluginId))
    .forEach((pluginId) => {
      log(`Removing plugin '${pluginId}'...`);

      plugins.update((p) => {
        delete p[pluginId];
        return p;
      });
    });

  // Install plugin if it exists in pluginsInfo (BE) and not installed
  const notInstalledPlugins = Object.keys(pluginsInfo).filter(
    // this prevents it must be enabled and loaded in BE, otherwise UI is null
    (pluginId) => !get(plugins)[pluginId],
  );

  await Promise.all(
    notInstalledPlugins.map(async (pluginId) => {
      const pluginFolder = path.join(pluginsFolder, pluginId);
      const pluginManifest = pluginsInfo[pluginId];

      log(`Installing plugin '${pluginId}'...`);
      log(`Downloading '${pluginId}'...`);

      const file = await downloadPluginUiZip(pluginId);

      // Stage extraction in a sibling temp dir, then atomically rename into place.
      // This keeps requests from observing a half-populated pluginFolder.
      const tmpDir = path.join(pluginsFolder, `.${pluginId}.install.${process.pid}.${Date.now()}`);
      await downloadAndExtractZip(file, tmpDir);
      fs.writeFileSync(path.join(tmpDir, manifestFileName), JSON.stringify(pluginManifest, null, 2));

      if (fs.existsSync(pluginFolder)) {
        // A concurrent path created it first; discard our temp.
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } else {
        fs.renameSync(tmpDir, pluginFolder);
      }

      plugins.update((p) => {
        p[pluginId] = structuredClone(pluginManifest);
        return p;
      });

      log(`'${pluginId}' successfully installed.`);
    }),
  );

  // Verify plugin files
  await Promise.all(
    Object.keys(get(plugins)).map(async (pluginId) => {
      const pluginFolder = path.join(pluginsFolder, pluginId);

      const pluginInfoManifest = pluginsInfo[pluginId];
      if (!pluginInfoManifest) return;

      let pluginManifest = get(plugins)[pluginId];

      // if files not valid
      if (
        pluginManifest.version !== pluginInfoManifest.version ||
        pluginManifest.uiHash !== pluginInfoManifest.uiHash
      ) {
        log(`Updating plugin '${pluginId}'.`);
        log(`Downloading '${pluginId}'...`);

        const file = await downloadPluginUiZip(pluginId);

        // Stage in temp dir so download time doesn't leave pluginFolder mid-mutation.
        const tmpDir = path.join(pluginsFolder, `.${pluginId}.update.${process.pid}.${Date.now()}`);
        await downloadAndExtractZip(file, tmpDir);

        // Atomic-ish swap of server/ and client/: rename old aside (constant-time),
        // rename new into place. The window where a subdir is absent is now microseconds
        // rather than seconds.
        const oldServer = path.join(pluginFolder, '.server.old');
        const oldClient = path.join(pluginFolder, '.client.old');

        if (fs.existsSync(path.join(pluginFolder, 'server'))) {
          fs.renameSync(path.join(pluginFolder, 'server'), oldServer);
        }
        if (fs.existsSync(path.join(tmpDir, 'server'))) {
          fs.renameSync(path.join(tmpDir, 'server'), path.join(pluginFolder, 'server'));
        }

        if (fs.existsSync(path.join(pluginFolder, 'client'))) {
          fs.renameSync(path.join(pluginFolder, 'client'), oldClient);
        }
        if (fs.existsSync(path.join(tmpDir, 'client'))) {
          fs.renameSync(path.join(tmpDir, 'client'), path.join(pluginFolder, 'client'));
        }

        // Manifest reflects what is on disk now.
        plugins.update((p) => {
          p[pluginId] = structuredClone(pluginInfoManifest);
          return p;
        });
        pluginManifest = get(plugins)[pluginId];
        fs.writeFileSync(path.join(pluginFolder, manifestFileName), JSON.stringify(pluginManifest, null, 2));

        fs.rmSync(oldServer, { recursive: true, force: true });
        fs.rmSync(oldClient, { recursive: true, force: true });
        fs.rmSync(tmpDir, { recursive: true, force: true });

        log(`'${pluginId}' successfully updated.`);
      }
    }),
  );
}

export async function preparePlugins(siteInfo) {
  const currentBackendHash = JSON.stringify(siteInfo.plugins);

  // Loop so that after awaiting another request's preparation we recheck the cache: it may
  // have produced the state we need (then we exit immediately), or it may have produced a
  // different state (then we claim a fresh run).
  while (true) {
    if (preparePluginsInflight) {
      try { await preparePluginsInflight; } catch { /* the owner re-throws to its caller */ }
      continue;
    }

    const isCacheHit = !browser && !siteInfo.developmentMode && serverSidePrepared && lastProcessedBackendHash === currentBackendHash;
    if (isCacheHit) break;

    // Claim the lock synchronously before any await — otherwise two callers can both observe
    // `preparePluginsInflight === null` and race.
    preparePluginsInflight = (async () => {
      createPluginsFolder();
      const pluginsInFolder = readPluginsFromFolder(siteInfo);
      await verifyPlugins(pluginsInFolder, siteInfo);
      if (!browser) {
        serverSidePrepared = true;
        lastProcessedBackendHash = currentBackendHash;
      }
    })();
    try {
      await preparePluginsInflight;
    } finally {
      preparePluginsInflight = null;
    }
    break;
  }

  const newSiteInfoPlugins = {};
  const loadedPlugins = get(plugins);
  Object.keys(loadedPlugins).forEach((pluginId) => {
    const plugin = loadedPlugins[pluginId];
    // In some versions version is an object containing metadata, in others it's directly on the plugin.
    const vObj = plugin.version;
    const { version, uiHash } = (vObj && typeof vObj === 'object') ? vObj : plugin;
    const deps = plugin.dependencies;
    newSiteInfoPlugins[pluginId] = { version, uiHash, ...(deps ? { dependencies: deps } : {}) };
  });
  siteInfo.plugins = newSiteInfoPlugins;
}


function generateStablePluginHash(siteInfoPlugins) {
  const stableData = {};
  for (const [id, plugin] of Object.entries(siteInfoPlugins || {})) {
    const vObj = plugin.version;
    const { version, uiHash } = (vObj && typeof vObj === "object") ? vObj : plugin;
    stableData[id] = { version, uiHash };
  }
  return JSON.stringify(stableData);
}

// Live plugin instances on the client. Re-init calls __destroy() on these so a
// plugin's onUnload runs and any subscriptions it registered via this._unsubscribers
// get cleaned up before its next onLoad (or before it disappears on disable/remove).
const livePluginInstances = new Map();

async function destroyLivePluginInstances() {
  if (livePluginInstances.size === 0) return;
  const entries = Array.from(livePluginInstances.entries());
  livePluginInstances.clear();
  await Promise.allSettled(
    entries.map(async ([pluginId, instance]) => {
      try {
        await instance.__destroy?.();
      } catch (e) {
        if (dev) console.error(`[PluginManager] __destroy failed for ${pluginId}:`, e);
      }
    })
  );
}

export async function initializePlugins(siteInfo) {
  const currentFrontendHash = generateStablePluginHash(siteInfo.plugins);

  // SSR cache: skip if already initialized with the same plugin set
  if (!browser && !siteInfo.developmentMode && serverSideInitialized && lastProcessedFrontendHash === currentFrontendHash) {
    return;
  }

  // Client-side cache: skip if already initialized with the same plugin set
  if (browser && clientSideInitialized && clientSidePluginHash === currentFrontendHash) {
    return;
  }

  registeredPages = {};

  if (browser) {
    await destroyLivePluginInstances();
  }

  await initPluginAPI();

  if (browser) {
    const pluginsInfo = siteInfo.plugins;

    plugins.set(pluginsInfo);
  }

  await loadPlugins(siteInfo);

  if (!browser) {
    serverSideInitialized = true;
    lastProcessedFrontendHash = currentFrontendHash;
  } else {
    clientSideInitialized = true;
    clientSidePluginHash = currentFrontendHash;
  }
}


const moduleCache = new Map();

function buildPluginDependencyGraph(loadedPlugins) {
  const pluginIds = new Set(Object.keys(loadedPlugins));
  const graph = {};
  for (const pluginId of pluginIds) {
    const plugin = loadedPlugins[pluginId];
    // Only include dependencies that are actually loaded
    const deps = (plugin.dependencies || []).filter(dep => pluginIds.has(dep));
    graph[pluginId] = deps;
  }
  return graph;
}

function topologicalSortPlugins(graph) {
  const inDegree = {};
  const adj = {};

  for (const node of Object.keys(graph)) {
    if (!(node in inDegree)) inDegree[node] = 0;
    if (!(node in adj)) adj[node] = [];
  }

  for (const [node, deps] of Object.entries(graph)) {
    for (const dep of deps) {
      if (!(dep in adj)) {
        adj[dep] = [];
      }
      if (!(dep in inDegree)) inDegree[dep] = 0;
      adj[dep].push(node);
      inDegree[node] = (inDegree[node] || 0) + 1;
    }
  }

  const levels = [];
  let queue = Object.keys(inDegree).filter(n => inDegree[n] === 0);

  while (queue.length > 0) {
    levels.push([...queue]);
    const nextQueue = [];
    for (const node of queue) {
      for (const neighbor of (adj[node] || [])) {
        inDegree[neighbor]--;
        if (inDegree[neighbor] === 0) nextQueue.push(neighbor);
      }
    }
    queue = nextQueue;
  }

  // Fallback: if circular deps prevent resolution, run remaining plugins
  const resolved = new Set(levels.flat());
  const unresolved = Object.keys(graph).filter(n => !resolved.has(n));
  if (unresolved.length > 0) {
    levels.push(unresolved);
  }

  return levels;
}

async function loadPlugins(siteInfo) {
  // Phase 1: Import all plugin modules in parallel for faster loading
  const pluginIds = Object.keys(get(plugins));

  await Promise.all(
    pluginIds.map(async (pluginId) => {
      const plugin = get(plugins)[pluginId];
      if (!plugin) return;

      if (browser) {
        // The `?v=<uiHash>` segment is what gives this URL meaning as a content identifier:
        // the browser module cache is keyed by URL, so distinct hashes get distinct cache
        // entries. Without this, a plugin update mutates server-side files but the browser
        // keeps using the old module from its cache for the rest of the session.
        const uiHashSuffix = plugin.uiHash ? `?v=${plugin.uiHash}` : '';
        try {
          plugin.module = await import(
            /* @vite-ignore */ `${base}/plugins/${pluginId}/resources/plugin-ui/client/client.mjs${uiHashSuffix}`
            );
        } catch (e) {
          // We land here when (a) the plugin was just updated and the file is mid-rename, or
          // (b) the user's tab carries a now-deleted plugin reference. Silently deleting the
          // plugin from the store like before left the UI in an inconsistent state — code
          // executed in this session would behave as if the plugin doesn't exist. The only
          // way to resync everything (registered routes, components, hooks) is a full reload.
          console.warn(`[Plugin Manager] '${pluginId}' client module failed to load, reloading…`, e);
          location.reload();
          throw e;
        }
      } else {
        const pluginFolder = path.join(pluginsFolder, pluginId);
        const pluginManifest = plugin;
        const pluginHash = pluginManifest.uiHash || "no-hash";
        const cacheKey = `${pluginId}-${pluginHash}`;

        if (moduleCache.has(cacheKey) && !siteInfo.developmentMode) {
          plugin.module = moduleCache.get(cacheKey);
          return;
        }

        const timestamp = siteInfo.developmentMode ? `?${Date.now()}` : "";
        const mainPath = path.join(pluginFolder, "server", "server.mjs") + timestamp;

        const __filename = url.fileURLToPath(import.meta.url);

        const currentDir = path.dirname(__filename); // Directory of the current file
        const targetFile = path.resolve(currentDir, process.cwd()); // Absolute path of the target file

        const relativePath = path.relative(currentDir, targetFile);
        const levels = relativePath.split(path.sep).length;

        const upDirs = `..${path.sep}`.repeat(levels); // Repeating '../' based on the number of levels

        let module;

        try {
          module = await import(/* @vite-ignore */ upDirs + mainPath);
        } catch {
          try {
            module = await import(
              /* @vite-ignore */ "file://" +
            path.join(path.resolve(upDirs + mainPath, process.cwd(), mainPath))
              );
          } catch (e) {
            error(`${pluginId} could not run! Error:`);
            error(e);

            plugins.update((p) => {
              delete p[pluginId];
              return p;
            });

            return;
          }
        }

        plugin.module = module;
        if (!siteInfo.developmentMode) {
          moduleCache.set(cacheKey, module);
        }
      }
    })
  );

  // Phase 2: Initialize plugins with dependency-aware batching (topological sort)
  // Plugins at the same dependency level run in parallel; levels execute sequentially
  const pluginDepGraph = buildPluginDependencyGraph(get(plugins));
  const loadLevels = topologicalSortPlugins(pluginDepGraph);

  for (const level of loadLevels) {
    await Promise.all(
      level.map(async (pluginId) => {
        const plugin = get(plugins)[pluginId];
        if (!plugin?.module?.default) return;

        const PluginClass = plugin.module.default;

        if (PluginClass instanceof PanoPlugin) {
          throw new Error("Plugin must extend PanoPlugin");
        }

        const instance = new PluginClass({ pluginId });

        instance.pano = browser ? panoApiClient : panoApiServer;

        if (browser) {
          livePluginInstances.set(pluginId, instance);
        }

        try {
          await instance.onLoad();
        } catch (e) {
          if (dev) console.error(`[PluginManager] Failed to load plugin ${pluginId}:`, e);
        }
      })
    );
  }
}
