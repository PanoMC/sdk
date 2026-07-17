import fs from "fs";

import { error as httpError } from "@sveltejs/kit";
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

// In-flight initializePlugins promise, keyed by the frontend plugin hash it is building for.
// Without it, concurrent SSR requests each reset the shared module-global stores (registeredPages,
// livePluginInstances, the plugins store) mid-flight, racing each other into torn/blank plugin UI,
// double onLoad calls and transient false 404s. Claimed synchronously before any await.
let initializePluginsInflight = null;
let initializePluginsInflightHash = null;



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

// A plugin folder counts as "intact" only if all three pieces produced by a real install
// are present: the root manifest.json and both the server/ and client/ subdirs. Anything
// else is a shell folder — left over from a download that 404'd, an extraction that
// produced an empty zip, an update that swapped out the old subdirs and then couldn't
// move new ones in, or a crashed install/update where the staging dir never got renamed
// into place. We need to recognize and purge these eagerly: readPluginsFromFolder silently
// drops them (manifest read fails → not in pluginsInFolder), so they slip past the rest
// of verifyPlugins and then make the install path's existsSync check think the plugin
// is "already there", which discards the fresh download.
function isPluginFolderIntact(pluginFolder) {
  return (
    fs.existsSync(path.join(pluginFolder, manifestFileName)) &&
    isDirectory(path.join(pluginFolder, 'server')) &&
    isDirectory(path.join(pluginFolder, 'client'))
  );
}

function purgeIncompletePluginFolders() {
  let entries;
  try {
    entries = fs.readdirSync(pluginsFolder);
  } catch {
    return;
  }

  entries.forEach((entry) => {
    const entryPath = path.join(pluginsFolder, entry);
    if (!isDirectory(entryPath)) return;

    // Stale staging dirs from a previous crashed install/update (".pluginId.install.<pid>.<ts>"
    // / ".pluginId.update.<pid>.<ts>"). The preparePluginsInflight lock guarantees no
    // install is running in parallel with verifyPlugins, so any leading-dot dir here is
    // dead and safe to remove.
    if (entry.startsWith('.')) {
      log(`Removing stale staging dir '${entry}'...`);
      fs.rmSync(entryPath, { recursive: true, force: true });
      return;
    }

    if (!isPluginFolderIntact(entryPath)) {
      log(`Removing incomplete plugin folder '${entry}'...`);
      fs.rmSync(entryPath, { recursive: true, force: true });
      // Also drop it from the live store if a previous run added it there.
      plugins.update((p) => {
        delete p[entry];
        return p;
      });
    }
  });
}

async function verifyPlugins(siteInfo) {
  // this method is fully BFF (backend for front-end) SSR

  const pluginsInfo = siteInfo.plugins;

  // Phase 0: scrub any shell/staging folders before we trust readPluginsFromFolder's view.
  // Doing this up front means the rest of verifyPlugins operates on a known-clean disk,
  // which kills the failure mode where a half-installed folder kept making the install
  // path's existsSync check throw away every fresh download. The caller's
  // pluginsInFolder snapshot is discarded — we re-read after purge.
  purgeIncompletePluginFolders();

  const pluginsInFolder = readPluginsFromFolder(siteInfo);
  const pluginIdInFolderList = Object.keys(pluginsInFolder);

  // After Phase 0 every folder on disk is intact (manifest + server/ + client/), so
  // pluginIdInFolderList only contains plugins we can trust. The legacy "fix broken
  // folder" pass that used to live here is now redundant — Phase 0 covers every shape
  // of brokenness it tried to repair, and does so before we trust the snapshot.
  pluginIdInFolderList.forEach((pluginId) => {
    // Wipe plugins the BE no longer reports (disabled, uninstalled, lost license, etc.).
    if (!pluginsInfo[pluginId]) {
      log(`Removing '${pluginId}' folder...`);

      fs.rmSync(path.join(pluginsFolder, pluginId), {
        recursive: true,
        force: true,
      });

      plugins.update((p) => {
        delete p[pluginId];
        return p;
      });
      return;
    }

    // Plugin is intact on disk and still wanted by the BE — surface it via the store.
    //
    // Dev mode used to WIPE every folder here on every SSR pass so `bun dev` rebuilds
    // reach the page without needing the BE-side uiHash to roll. That opened a window
    // spanning the whole re-download in which /plugins/<id>/resources/... 404'd: any
    // browser module fetch racing an SSR pass failed, and when its one cache-busted
    // retry landed in the same window the plugin was dropped for the entire session
    // (page renders via SSR, then loses every plugin UI at CSR). Instead, poison the
    // stored uiHash so the update pass below re-downloads just as eagerly, but through
    // downloadAndInstallPlugin's staged download + atomic rename — the old build keeps
    // serving until the new one is in place, so the missing-folder window collapses
    // from ~download-time to the two-rename instant (which the browser-side
    // cache-busted retry already absorbs).
    plugins.update((p) => {
      p[pluginId] = siteInfo.developmentMode
        ? { ...pluginsInFolder[pluginId], uiHash: `dev-stale-${Date.now()}` }
        : pluginsInFolder[pluginId];
      return p;
    });
  });

  // Drop store entries the current pluginIdInFolderList no longer backs (e.g. left
  // over from a previous run before Phase 0 deleted the underlying folder).
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
    notInstalledPlugins.map((pluginId) =>
      downloadAndInstallPlugin(pluginId, pluginsInfo[pluginId], 'install'),
    ),
  );

  // Update plugins whose on-disk version/uiHash doesn't match what the backend now serves.
  // This is where dev-mode `bun dev` rebuilds get picked up (BE bumps the hash, we re-fetch).
  await Promise.all(
    Object.keys(get(plugins)).map(async (pluginId) => {
      const pluginInfoManifest = pluginsInfo[pluginId];
      if (!pluginInfoManifest) return;

      const pluginManifest = get(plugins)[pluginId];
      if (
        pluginManifest.version === pluginInfoManifest.version &&
        pluginManifest.uiHash === pluginInfoManifest.uiHash
      ) {
        return;
      }

      await downloadAndInstallPlugin(pluginId, pluginInfoManifest, 'update');
    }),
  );
}

/**
 * Download the plugin-ui.zip for a plugin and atomically replace its folder with the new
 * content. Used for both first-time installs and updates — the two used to have separate
 * code paths and the update path's per-subdir swap could leave the folder as a manifest-
 * only shell when the downloaded zip was malformed (no server/ or no client/ inside).
 * One code path means one set of invariants to enforce.
 *
 * Invariant after a successful return: pluginFolder contains manifest.json + server/ +
 * client/, and the `plugins` store entry matches what's on disk.
 *
 * On any failure (download error, malformed zip, missing server/ or client/, fs error)
 * we leave the previous on-disk state untouched (so an old working build keeps serving)
 * and drop the plugin from the store so the rest of the SSR pass and the browser-side
 * loader skip it cleanly instead of trying to import files that don't exist. The
 * `bun dev` workflow is unaffected: BE bumps the uiHash on rebuild, this function runs,
 * and the new build replaces the old one wholesale.
 */
async function downloadAndInstallPlugin(pluginId, pluginManifest, mode) {
  const pluginFolder = path.join(pluginsFolder, pluginId);
  const tmpDir = path.join(pluginsFolder, `.${pluginId}.${mode}.${process.pid}.${Date.now()}`);

  log(`${mode === 'install' ? 'Installing' : 'Updating'} plugin '${pluginId}'...`);
  log(`Downloading '${pluginId}'...`);

  try {
    const file = await downloadPluginUiZip(pluginId);
    await downloadAndExtractZip(file, tmpDir);

    // Skip plugins whose download didn't yield a valid UI build. This is the symptom of
    // either a 404/empty response that adm-zip didn't reject, or a publisher mistake.
    // Either way we don't want to commit a manifest-only shell folder to disk.
    if (
      !isDirectory(path.join(tmpDir, 'server')) ||
      !isDirectory(path.join(tmpDir, 'client'))
    ) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      error(`Plugin '${pluginId}' download is missing server/ or client/ — skipping.`);
      plugins.update((p) => {
        delete p[pluginId];
        return p;
      });
      return;
    }

    fs.writeFileSync(path.join(tmpDir, manifestFileName), JSON.stringify(pluginManifest, null, 2));

    // Full-folder swap: rm-rf the old (Phase 0 already removed anything broken; the only
    // case `pluginFolder` exists here is a clean update), then rename our staged dir in.
    // The window where pluginFolder is briefly missing is the two-rename interval —
    // microseconds — and Phase 0 + the inflight lock guarantee nothing else is reading
    // mid-swap from SSR. Browser-side imports race against rename naturally; if one
    // lands in the gap it 404s, and the PluginManager's reload-once retry resolves it.
    fs.rmSync(pluginFolder, { recursive: true, force: true });
    fs.renameSync(tmpDir, pluginFolder);

    plugins.update((p) => {
      p[pluginId] = structuredClone(pluginManifest);
      return p;
    });

    log(`'${pluginId}' successfully ${mode === 'install' ? 'installed' : 'updated'}.`);
  } catch (e) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    error(`Failed to ${mode} plugin '${pluginId}': ${e?.message ?? e}`);
    // Don't surface the error: a single bad plugin must not break SSR for the rest of
    // the panel. Drop the entry so downstream code doesn't try to load it.
    plugins.update((p) => {
      delete p[pluginId];
      return p;
    });
  }
}

export async function preparePlugins(siteInfo) {
  // The backend is the source of truth for the plugin set. While it is unreachable
  // (still booting, restarting, crashed) siteInfo arrives undefined/empty — fail with a
  // real 503 instead of a TypeError-turned-500 with a stack trace, so proxies and
  // monitoring see "temporarily unavailable" and the first request after the backend
  // returns recovers normally.
  if (!siteInfo || typeof siteInfo !== "object" || !siteInfo.plugins) {
    throw httpError(503, "Pano backend is not reachable yet");
  }

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
      await verifyPlugins(siteInfo);
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
  // Sort plugin ids so the hash is independent of object iteration order.
  for (const id of Object.keys(siteInfoPlugins || {}).sort()) {
    const plugin = siteInfoPlugins[id];
    const vObj = plugin.version;
    const { version, uiHash } = (vObj && typeof vObj === "object") ? vObj : plugin;
    // Include dependencies (load-order relevant): a dep-only change must invalidate the init
    // cache, otherwise the topological load order can go stale while version/uiHash are equal.
    // Normalize to a sorted array so the dep set — not its declaration order — is what matters.
    const deps = Array.isArray(plugin.dependencies) ? [...plugin.dependencies].sort() : [];
    stableData[id] = { version, uiHash, dependencies: deps };
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

function isInitializeCacheHit(siteInfo, currentFrontendHash) {
  // SSR cache: skip if already initialized with the same plugin set
  if (!browser && !siteInfo.developmentMode && serverSideInitialized && lastProcessedFrontendHash === currentFrontendHash) {
    return true;
  }
  // Client-side cache: skip if already initialized with the same plugin set
  if (browser && clientSideInitialized && clientSidePluginHash === currentFrontendHash) {
    return true;
  }
  return false;
}

async function doInitializePlugins(siteInfo, currentFrontendHash) {
  // Build the new route table in a LOCAL map and swap the live binding atomically once it is
  // fully populated, instead of clearing the live `registeredPages` and rebuilding it in place.
  // Plugins register into the live binding from their onLoad (via PluginAPI), so we point it at
  // the fresh map for the duration of the build and only ever expose a complete table — a
  // reader (findMatch) racing a rebuild sees either the old complete table or the new complete
  // one, never a half-cleared one.
  const previousRegisteredPages = registeredPages;
  const newRegisteredPages = {};
  registeredPages = newRegisteredPages;

  try {
    if (browser) {
      await destroyLivePluginInstances();
    }

    await initPluginAPI();

    if (browser) {
      const pluginsInfo = siteInfo.plugins;

      plugins.set(pluginsInfo);
    }

    await loadPlugins(siteInfo);
  } catch (e) {
    // On failure, restore the previous complete table so we don't leave a partial one live.
    registeredPages = previousRegisteredPages;
    throw e;
  }

  if (!browser) {
    serverSideInitialized = true;
    lastProcessedFrontendHash = currentFrontendHash;
  } else {
    clientSideInitialized = true;
    clientSidePluginHash = currentFrontendHash;
  }
}

export async function initializePlugins(siteInfo) {
  const currentFrontendHash = generateStablePluginHash(siteInfo.plugins);

  // Loop so that after awaiting another request's in-flight init we recheck the cache: it may
  // have produced exactly the state we need (exit), or a different one (claim a fresh run).
  while (true) {
    if (isInitializeCacheHit(siteInfo, currentFrontendHash)) return;

    if (initializePluginsInflight) {
      // Someone is already initializing. If it's for our hash, just await it and we're done;
      // otherwise await it and re-loop to claim our own run against the now-settled state.
      const sameHash = initializePluginsInflightHash === currentFrontendHash;
      try { await initializePluginsInflight; } catch { /* the owner re-throws to its caller */ }
      if (sameHash && isInitializeCacheHit(siteInfo, currentFrontendHash)) return;
      continue;
    }

    // Claim the lock synchronously before any await — otherwise two callers can both observe
    // `initializePluginsInflight === null` and race, each resetting the shared stores.
    initializePluginsInflightHash = currentFrontendHash;
    initializePluginsInflight = doInitializePlugins(siteInfo, currentFrontendHash);
    try {
      await initializePluginsInflight;
    } finally {
      initializePluginsInflight = null;
      initializePluginsInflightHash = null;
    }
    return;
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
        const reloadKey = `pano:plugin-reload:${pluginId}:${plugin.uiHash || 'no-hash'}`;
        const moduleUrl = `${base}/plugins/${pluginId}/resources/plugin-ui/client/client.mjs${uiHashSuffix}`;
        // Permanent, deterministic failures where re-fetching the exact same bytes fails
        // identically forever — reloading is useless and punishes every fresh tab:
        //  - SyntaxError / "does not provide an export named …" / "is not a module":
        //    the plugin was built against a different svelte/SDK (ABI/version skew).
        //  - "Failed to resolve module specifier" (Chrome) / "was a bare specifier" (Firefox)
        //    / "does not resolve to a valid URL" (Safari): the plugin imports a bare
        //    specifier absent from the host import map — resolution never touches the
        //    network, so retry and reload cannot change the outcome.
        //  - "[pano-runtime] …": the host runtime registry rejected the specifier.
        const isVersionSkewError = (err) =>
          err instanceof SyntaxError ||
          /does not provide an export named|is not a module|Unexpected (token|reserved word|end of input)|Failed to resolve module specifier|bare specifier|does not resolve to a valid URL|pano-runtime/i.test(
            String(err?.message ?? err),
          );
        try {
          try {
            plugin.module = await import(/* @vite-ignore */ moduleUrl);
          } catch (firstError) {
            if (isVersionSkewError(firstError)) throw firstError;
            // A failed module fetch is cached in the document's module map (per HTML
            // spec) — re-importing the SAME URL returns the cached failure without a
            // network attempt. A changed query string is a new module-map key AND a
            // new HTTP-cache key, so transient 404s (mid-update swap window, proxy
            // hiccup) recover here without the full reload below.
            const retryUrl = `${moduleUrl}${uiHashSuffix ? '&' : '?'}r=${Date.now().toString(36)}`;
            console.warn(`[Plugin Manager] '${pluginId}' client module failed to load, retrying with cache-bust…`, firstError);
            plugin.module = await import(/* @vite-ignore */ retryUrl);
          }
          sessionStorage.removeItem(reloadKey);
        } catch (e) {
          // Classify the failure before deciding whether to reload. A reload only helps the
          // genuinely *transient* cases — the plugin was updated and a chunk is mid-rename, or
          // the file briefly 404s during the two-rename swap — where a fresh fetch resolves it.
          //
          // Version skew (see isVersionSkewError above): reloading punishes every fresh tab
          // with a forced refresh loop, so we skip the plugin immediately with a warn and NO
          // reload.
          if (isVersionSkewError(e)) {
            console.warn(`[Plugin Manager] '${pluginId}' client module failed to load and looks like a version mismatch (the plugin may be built for an incompatible svelte/SDK version); skipping without reload.`, e);
            sessionStorage.removeItem(reloadKey);
            plugins.update((p) => {
              delete p[pluginId];
              return p;
            });
            return;
          }

          // Transient case (chunk-missing / mid-rename): reload once to resync — but only once
          // per uiHash, since a permanent 404 would otherwise cause an infinite F5 loop.
          const alreadyReloaded = sessionStorage.getItem(reloadKey) === '1';
          if (!alreadyReloaded) {
            sessionStorage.setItem(reloadKey, '1');
            console.warn(`[Plugin Manager] '${pluginId}' client module failed to load, reloading once…`, e);
            location.reload();
            throw e;
          }
          // Second failure for the same uiHash: stop the loop. Drop the plugin from the store
          // so the UI can render the rest of the page without it.
          console.error(`[Plugin Manager] '${pluginId}' client module is permanently broken (uiHash=${plugin.uiHash}); skipping. The on-disk plugin files are likely corrupt — clear the panel-ui 'plugins/${pluginId}' folder on the server.`, e);
          plugins.update((p) => {
            delete p[pluginId];
            return p;
          });
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

        // Cache-buster for Node's ESM module cache (keyed by resolved URL). In dev we use a
        // timestamp so every SSR pass re-imports the freshly rebuilt module. In production we
        // mirror the client branch and key on the plugin's uiHash: without this the ESM cache
        // returns the STALE server module after a plugin update, producing an SSR/client
        // hydration mismatch (client uses the new hashed module, server keeps the old one).
        const importSuffix = siteInfo.developmentMode
          ? `?${Date.now()}`
          : (pluginHash !== "no-hash" ? `?v=${pluginHash}` : "");
        const mainPath = path.join(pluginFolder, "server", "server.mjs") + importSuffix;

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
          // Evict this plugin's previous (different-uiHash) entries before caching the new one,
          // so moduleCache stays bounded — without this it grew one stale entry per plugin
          // update for the lifetime of the process, and old modules were never released.
          const prefix = `${pluginId}-`;
          for (const key of moduleCache.keys()) {
            if (key !== cacheKey && key.startsWith(prefix)) {
              moduleCache.delete(key);
            }
          }
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

        // Validate BEFORE instantiating. `PluginClass` is a constructor, so the old
        // `PluginClass instanceof PanoPlugin` was always false and never rejected anything.
        // A strict `prototype instanceof PanoPlugin` is wrong across bundles too: released
        // plugins bundle their OWN copy of the SDK, so their PanoPlugin base class is a
        // different identity than the host's. Accept the cross-bundle duck-type marker
        // (`static isPanoPlugin`, inherited by subclasses), and skip the offending plugin
        // instead of throwing — one bad plugin must not kill the whole load level.
        const isValidPluginClass =
          typeof PluginClass === "function" &&
          (PluginClass === PanoPlugin ||
            PluginClass.prototype instanceof PanoPlugin ||
            PluginClass.isPanoPlugin === true);

        if (!isValidPluginClass) {
          error(`Plugin '${pluginId}' does not extend PanoPlugin; skipping.`);
          plugins.update((p) => {
            delete p[pluginId];
            return p;
          });
          return;
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
