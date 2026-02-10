import fs from 'fs';

import { browser } from '$app/environment';
import { writable, get } from 'svelte/store';
import ApiUtil from '$lib/api.util.js';
import { base } from '$app/paths';

import { init as initPluginAPI, panoApiClient, panoApiServer } from '$lib/PluginAPI.js';
import { PanoPlugin } from '@panomc/sdk';
import { findMatch } from './RouteMatcher.js';

export let registeredPages = {};

export { findMatch };

let path, url, admZip;

let serverSidePrepared = false;
let serverSideInitialized = false;
let lastSiteInfoHash = null;


if (!browser) {
  const pathStuff = await import('path');
  const urlStuff = await import('url');
  const admZipStuff = await import('adm-zip');

  path = pathStuff;
  url = urlStuff;
  admZip = admZipStuff.default;
}

const plugins = writable({});

const pluginsFolder = 'plugins';
const manifestFileName = 'manifest.json';
const pluginUiZipFileName = 'plugin-ui.zip';

function log(message) {
  console.log(`[Plugin Manager] ${message}`);
}

function error(message) {
  console.error(`[Plugin Manager] ${message}`);
}

function debug(message) {
  console.debug(`[Plugin Manager] ${message}`);
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
      const manifestFilePath = path.join(pluginFolder, manifestFileName);
      const pluginManifest = pluginsInfo[pluginId];

      log(`Installing plugin '${pluginId}'...`);

      if (!fs.existsSync(pluginFolder)) {
        fs.mkdirSync(pluginFolder, { recursive: true });
      }

      plugins.update((p) => {
        p[pluginId] = structuredClone(pluginManifest);
        return p;
      });

      log(`Downloading '${pluginId}'...`);

      const file = await downloadPluginUiZip(pluginId);

      await downloadAndExtractZip(file, pluginFolder);

      fs.writeFileSync(manifestFilePath, JSON.stringify(pluginManifest, null, 2));

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
        const manifestFilePath = path.join(pluginFolder, manifestFileName);

        log(`Updating plugin '${pluginId}'.`);

        plugins.update((p) => {
          p[pluginId] = structuredClone(pluginInfoManifest);
          return p;
        });
        pluginManifest = get(plugins)[pluginId];
        fs.writeFileSync(manifestFilePath, JSON.stringify(pluginManifest, null, 2));

        fs.rmSync(path.join(pluginsFolder, pluginId, 'server'), {
          recursive: true,
          force: true,
        });
        fs.rmSync(path.join(pluginsFolder, pluginId, 'client'), {
          recursive: true,
          force: true,
        });

        log(`Downloading '${pluginId}'...`);

        const file = await downloadPluginUiZip(pluginId);

        await downloadAndExtractZip(file, pluginFolder);
        log(`'${pluginId}' successfully updated.`);
      }
    }),
  );
}

export async function preparePlugins(siteInfo) {
  if (!browser && !siteInfo.developmentMode) {
    const currentHash = JSON.stringify(siteInfo.plugins);
    if (serverSidePrepared && lastSiteInfoHash === currentHash) {
      return;
    }
  }

  createPluginsFolder();

  const pluginsInFolder = readPluginsFromFolder(siteInfo);

  await verifyPlugins(pluginsInFolder, siteInfo);

  const newSiteInfoPlugins = {};
  Object.keys(get(plugins)).forEach((pluginId) => {
    const plugin = get(plugins)[pluginId];
    const { version, uiHash } = plugin.version;
    newSiteInfoPlugins[pluginId] = { version, uiHash };
  });
  siteInfo.plugins = newSiteInfoPlugins;

  if (!browser) {
    serverSidePrepared = true;
    lastSiteInfoHash = JSON.stringify(siteInfo.plugins);
  }
}

export async function initializePlugins(siteInfo) {
  if (!browser && !siteInfo.developmentMode && serverSideInitialized) {
    if (lastSiteInfoHash === JSON.stringify(siteInfo.plugins)) {
      return;
    }
  }

  registeredPages = {};

  await initPluginAPI();

  if (browser) {
    const pluginsInfo = siteInfo.plugins;

    plugins.set(pluginsInfo);
  }

  await loadPlugins(siteInfo);

  if (!browser) {
    serverSideInitialized = true;
  }
}

const moduleCache = new Map();

async function loadPlugins(siteInfo) {
  for (const pluginId of Object.keys(get(plugins))) {
    const plugin = get(plugins)[pluginId];

    if (browser) {
      try {
        plugin.module = await import(
          /* @vite-ignore */ `${base}/plugins/${pluginId}/resources/plugin-ui/client/client.mjs`
        );
      } catch (e) {
        plugins.update((p) => {
          delete p[pluginId];
          return p;
        });
      }
    } else {
      const pluginFolder = path.join(pluginsFolder, pluginId);
      const pluginManifest = plugin;
      const pluginHash = pluginManifest.uiHash || 'no-hash';
      const cacheKey = `${pluginId}-${pluginHash}`;

      if (moduleCache.has(cacheKey) && !siteInfo.developmentMode) {
        plugin.module = moduleCache.get(cacheKey);
        continue;
      }

      const timestamp = siteInfo.developmentMode ? `?${Date.now()}` : '';
      const mainPath = path.join(pluginFolder, 'server', 'server.mjs') + timestamp;

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
            /* @vite-ignore */ 'file://' +
            path.join(path.resolve(upDirs + mainPath, process.cwd(), mainPath))
          );
        } catch (e) {
          error(`${pluginId} could not run! Error:`);
          error(e);

          plugins.update((p) => {
            delete p[pluginId];
            return p;
          });

          continue;
        }
      }

      plugin.module = module;
      if (!siteInfo.developmentMode) {
        moduleCache.set(cacheKey, module);
      }
    }
  }

  for (const pluginId of Object.keys(get(plugins))) {
    const plugin = get(plugins)[pluginId];

    if (!plugin.module || !plugin.module.default) continue;

    const PluginClass = plugin.module.default;

    if (PluginClass instanceof PanoPlugin) {
      throw new Error('Plugin must extend PanoPlugin');
    }

    const instance = new PluginClass({ pluginId });

    instance.pano = browser ? panoApiClient : panoApiServer;

    try {
      await instance.onLoad();
    } catch (e) {
      console.error(`[PluginManager] Failed to load plugin ${pluginId}:`, e);
    }
  }
}
