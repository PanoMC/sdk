import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import svelte from 'rollup-plugin-svelte';
import resolve from '@rollup/plugin-node-resolve';
import del from 'rollup-plugin-delete';
import terser from '@rollup/plugin-terser';
import { loadConfig } from '../config.js';
import {
  DEFAULT_CONTROLLERS_DIR,
  ENTRY_ID,
  CONTROLLERS_ID,
  WRAPPER_RESOLVED_ID,
  panoEntry,
  panoControllersModule,
  listControllerFiles,
} from './entry.js';
import { panoViews } from './views.js';
import { panoRules } from './rules.js';
import { panoHelpers } from './helpers.js';
import { panoStamp } from './stamp.js';
import { panoControllers } from './controllers.js';
import { panoMeta } from './meta.js';
import { panoTypes } from './types.js';
import { panoSamples } from './samples.js';
import { panoWidgets, hasWidgetViews } from './widgets.js';
import { panoClientGen } from './client-gen.js';
import { panoSemanticClasses } from '../styles/semantic-classes.js';
import { createClassPolicy, panoBuildContext, viewClassInfo } from './integrate.js';
import { panoFallbackCss } from '../styles/fallback-css.js';
import { panoPluginCss } from '../styles/plugin-css.js';

/** Where the build writes the plugin UI package (relative to the plugin root). */
export const DEFAULT_OUT_DIR = 'src/main/resources/plugin-ui';

const SIDES = ['server', 'client', 'controllers', 'widgets'];
const PLUGIN_API_SPECIFIER = '@panomc/sdk/plugin-api';

/**
 * `export default panoPlugin();` in a plugin's rollup.config.js builds the server and client
 * bundles, the standalone controllers and (on request) the widgets, composing the kit
 * sub-plugins of doc 02's file map in this order: config, entry, views, rules/helpers/
 * stamp, controllers/meta/types, lock, samples/widgets/client-gen, styles.
 *
 * Returns a Promise (the plugin's `pano.plugin.js` is loaded with `import()`); rollup accepts a
 * promise as the default export of a config file.
 *
 * Defaults (today's behaviour of pano-boilerplate-plugin/rollup.config.js):
 *  - output `src/main/resources/plugin-ui/{server,client}` (`server.mjs`, `client.mjs`, `manifest.json`),
 *    the output folder is emptied once per build (by the client build, which runs first);
 *  - client: `svelte`, `svelte/*`, `svelte-i18n`, `@panomc/sdk`, `@panomc/sdk/*` stay external (the host
 *    import map provides them), unless `BUNDLE_SDK=true`; server: nothing external;
 *  - `PANO_SDK_DIR` (local delivery) aliases `@panomc/sdk*` to that folder and its pinned svelte version
 *    is checked against the installed one (a mismatch throws);
 *  - the plugin id is read from `gradle.properties`; `src/main.js` missing = `export default class extends PanoPlugin {}`;
 *  - `DEV=true` builds unminified with Svelte dev mode.
 *
 * Every kit sub-plugin also receives `{ side, outDir, root }` (all absolute) besides its documented
 * options; `side` is `'server'` or `'client'` for the two UI bundles, so a plugin that writes package files
 * once can do it on `client` only. The sub-plugins that write package files (rules, helpers, meta, types,
 * samples, client-gen, fallback/plugin css) only run in the client build; entry, views, stamp and the
 * semantic classes run in both.
 *
 * @param {{
 *   side?: 'server' | 'client' | 'controllers' | 'widgets',
 *   plugins?: import('rollup').Plugin[],
 *   bundle?: (id: string, importer?: string) => boolean,
 *   root?: string,
 *   outDir?: string,
 *   minify?: boolean,
 *   dev?: boolean,
 * }} [options]
 *   `side`: build only that target (default: client, server, controllers when the plugin has any, widgets when a view has `widget`);
 *   `plugins`: extra rollup plugins for the server and client builds, placed before the kit's own (so they
 *   can redirect an import first); `bundle`: return true for a specifier that is normally external but must
 *   be bundled in the client build; `root`: plugin root (default `process.cwd()`); `outDir`: package folder
 *   (default `src/main/resources/plugin-ui`); `minify` / `dev`: override `DEV`.
 * @returns {Promise<import('rollup').RollupOptions[]>}
 */
export async function panoPlugin(options = {}) {
  if (options.side !== undefined && !SIDES.includes(options.side)) {
    throw new Error(
      `[pano-plugin] panoPlugin({ side }) must be one of ${SIDES.join(', ')}, got "${options.side}"`,
    );
  }

  const root = path.resolve(options.root ?? process.cwd());
  const config = await loadConfig(root);
  const outDir = path.resolve(root, options.outDir ?? DEFAULT_OUT_DIR);
  const dev = options.dev ?? (!!process.env.DEV && process.env.DEV !== 'false');
  const minify = options.minify ?? !dev;
  const bundleSdk = process.env.BUNDLE_SDK === 'true';
  const sdkDir = config.sdkDir ?? findPackageDir(root, '@panomc/sdk');

  checkSvelteVersion({ root, sdkDir: config.sdkDir ?? sdkDir });

  const viewDirs = config.viewDirs.map((dir) => path.resolve(root, dir));
  const controllersDir = path.resolve(root, DEFAULT_CONTROLLERS_DIR);
  const mainFile = path.resolve(root, 'src/main.js');
  const common = { root, outDir };
  const ids = { pluginId: config.pluginId, namespace: config.namespace };
  const hasControllers = listControllerFiles(controllersDir).length > 0;
  const pluginApiFactory = await loadPluginApiFactory(sdkDir);

  // What the sub-plugins found about the views (rules: import mode, helpers: closure, stamp: controller
  // versions) is handed over in one object per build and copied into the package index by panoBuildContext.
  /** @type {Record<'server' | 'client', Record<string, any>>} */
  const contexts = { server: {}, client: {} };

  // The class rules of the build: the readable copy and the compiled view carry the root class
  // (doc 03 section 1.2); the lock keeps the classes of every view (section 1.3).
  /** @type {ReturnType<typeof panoViews> | null} */
  let viewsPlugin = null;
  const policy = createClassPolicy({
    root,
    ns: config.namespace,
    scan: () => viewsPlugin?.api.scan() ?? null,
    styles: config.styles,
  });

  /**
   * rollup-plugin-svelte `preprocess` entry: the root class on every view, so the compiled markup has it.
   *
   * @param {'server' | 'client'} side
   */
  function classPreprocess(side) {
    return panoSemanticClasses({
      ns: config.namespace,
      // rollup-plugin-svelte hands the preprocessors a path relative to the current directory
      views: (file) => {
        const absolute = path.resolve(file);

        return viewDirs.some((dir) => absolute.startsWith(dir + path.sep))
          ? path.basename(absolute, '.svelte')
          : null;
      },
      // both bundles compile the same sources: say it once
      warn: side === 'client' ? (message) => console.warn(`[pano-plugin] ${message}`) : () => {},
    });
  }

  /**
   * @param {'server' | 'client'} side
   * @returns {import('rollup').Plugin[]}
   */
  function kitPlugins(side) {
    const client = side === 'client';
    const context = contexts[side];
    const own = { ...common, side };
    const views = panoViews({
      ...own,
      ...ids,
      dirs: viewDirs,
      transformSource: (source, ctx) => viewClassInfo(source, ctx).code,
      classes: (info) => policy.infoOf(info).classes,
    });

    if (client) viewsPlugin = views;

    return [
      panoEntry({ ...own, ...ids, controllersDir, main: mainFile }),
      ...(pluginApiFactory ? [pluginApiFactory(config.pluginId)] : []),
      ...(options.plugins ?? []),
      ...(config.sdkDir ? [sdkAliasPlugin(config.sdkDir)] : []),
      panoControllersModule({ ...own, dir: controllersDir }),
      views,
      ...(client
        ? [
            panoRules({ ...own, viewDirs, controllersDir, context }),
            panoHelpers({ ...own, viewDirs, context }),
          ]
        : []),
      panoStamp({ ...own, viewDirs, context }),
      ...(client
        ? [
            panoBuildContext({ root, context, scan: () => views.api.scan(), policy }),
            panoMeta({ ...own, ...ids }),
            panoTypes({ ...own, dir: controllersDir }),
            panoSamples({ ...own, viewDirs }),
            panoClientGen({ ...own, ...ids }),
            panoFallbackCss({
              ...own,
              ns: config.namespace,
              viewsDir: viewDirs,
              safelist: config.styles.safelist,
              icons: config.styles.icons,
            }),
            panoPluginCss({ ...own, ns: config.namespace }),
          ]
        : []),
    ];
  }

  /**
   * @param {boolean} browser
   * @returns {import('rollup').Plugin}
   */
  function nodeResolve(browser) {
    return resolve({
      browser,
      rootDir: root,
      dedupe: browser ? ['svelte', '@panomc/sdk'] : ['svelte'],
      // Local delivery: the sdk folder holds the svelte version the plugin is pinned to.
      ...(config.sdkDir ? { modulePaths: [path.join(config.sdkDir, 'node_modules')] } : {}),
    });
  }

  /** @returns {import('rollup').Plugin[]} */
  function tail(dirName, withManifest) {
    return [
      ...(minify ? [terser()] : []),
      ...(withManifest ? [manifestPlugin(dirName)] : []),
    ];
  }

  const output = {
    format: /** @type {const} */ ('es'),
    chunkFileNames: '[name]-[hash].js',
    // The entry module state must live in ONE query-less chunk: the host imports client.mjs with a
    // cache-busting query while lazy chunks import './client.mjs' query-less, and the browser keys its module
    // map by full URL. client.mjs / server.mjs is therefore a pure re-export facade (pano:entry) and the
    // wrapper plus the author's src/main.js are forced into the shared 'main' chunk.
    manualChunks(/** @type {string} */ id) {
      if (id === WRAPPER_RESOLVED_ID || path.resolve(id) === mainFile) return 'main';
    },
  };

  // Svelte's own internals import each other in circles; that is noise, not a problem of the plugin.
  /** @type {import('rollup').WarningHandlerWithDefault} */
  const onwarn = (warning, defaultHandler) => {
    if (
      warning.code === 'CIRCULAR_DEPENDENCY' &&
      (warning.ids ?? []).every((id) => id.includes('node_modules'))
    ) {
      return;
    }

    defaultHandler(warning);
  };

  /** @type {Record<string, import('rollup').RollupOptions>} */
  const builds = {
    server: {
      input: ENTRY_ID,
      output: {
        ...output,
        dir: path.join(outDir, 'server'),
        entryFileNames: 'server.mjs',
      },
      plugins: [
        ...kitPlugins('server'),
        nodeResolve(false),
        svelte({
          compilerOptions: { generate: 'server', css: 'external' },
          emitCss: false,
          preprocess: classPreprocess('server'),
        }),
        ...tail('server', true),
      ],
      preserveEntrySignatures: 'strict',
    },

    client: {
      input: ENTRY_ID,
      output: {
        ...output,
        dir: path.join(outDir, 'client'),
        entryFileNames: 'client.mjs',
      },
      // Bare 'svelte'/'svelte/*', 'svelte-i18n' and '@panomc/sdk*' specifiers stay EXTERNAL in both dev and
      // production: the host injects an import map that resolves them to stable /runtime shim modules, and each
      // shim re-exports the HOST bundle's own live module instance. Host pages and plugins therefore share a
      // single Svelte runtime and a single SDK instance. Bundling a private SDK copy would split store and
      // context state, so the SDK is never bundled in normal builds (BUNDLE_SDK=true is the escape hatch).
      // The match is exact/subpath, NOT a prefix: third-party packages such as 'svelte-select' must be bundled.
      external: (id, importer) => {
        if (bundleSdk) return false;
        if (options.bundle?.(id, importer)) return false;

        return isHostSpecifier(id);
      },
      plugins: [
        ...kitPlugins('client'),
        nodeResolve(true),
        svelte({
          // emitCss: true hands the component CSS to panoPluginCss (plugin.css); svelte sets css: 'external' itself
          compilerOptions: { generate: 'client', dev },
          emitCss: true,
          preprocess: classPreprocess('client'),
        }),
        ...tail('client', true),
      ],
      preserveEntrySignatures: 'strict',
    },

    // Standalone controllers: controllers/controllers.mjs. The input is the virtual `pano:controllers`
    // module (a name -> definition map); panoControllers() may replace it from its `options` hook.
    controllers: {
      input: CONTROLLERS_ID,
      output: {
        format: 'es',
        dir: path.join(outDir, 'controllers'),
        entryFileNames: 'controllers.mjs',
        inlineDynamicImports: true,
      },
      plugins: [
        panoControllersModule({ ...common, side: 'controllers', dir: controllersDir }),
        panoControllers({ ...common, side: 'controllers', dir: controllersDir }),
        nodeResolve(false),
        ...tail('controllers', false),
      ],
    },

    // Widgets (doc 06 section 3): panoWidgets() owns the input through its `options` hook; until it sets
    // one this target builds an empty module.
    widgets: {
      input: '\0pano-widgets-empty',
      output: {
        format: 'es',
        dir: path.join(outDir, 'widgets'),
        entryFileNames: '[name].mjs',
      },
      plugins: [
        {
          name: 'pano-widgets-empty',
          resolveId: (source) => (source === '\0pano-widgets-empty' ? source : null),
          load: (id) => (id === '\0pano-widgets-empty' ? 'export default {};\n' : null),
        },
        panoWidgets({ ...common, side: 'widgets', ...ids }),
        nodeResolve(true),
        svelte({
          compilerOptions: { generate: 'client', css: 'external', dev },
          emitCss: false,
          preprocess: classPreprocess('server'),
        }),
        ...tail('widgets', false),
      ],
    },
  };

  // The default set: client first (only its scan of the views knows the part classes the lock holds, so a
  // server build run before it would stop on the lock of the previous build), then server, the controllers
  // when the plugin has any and the widgets when a view declares `widget`.
  const hasWidgets =
    !options.side &&
    (await hasWidgetViews({
      pluginId: config.pluginId,
      namespace: config.namespace,
      root,
      viewDirs: config.viewDirs,
    }));
  const selected = options.side
    ? [options.side]
    : [
        'client',
        'server',
        ...(hasControllers ? ['controllers'] : []),
        ...(hasWidgets ? ['widgets'] : []),
      ];

  const configs = selected.map((name) => ({ ...builds[name], onwarn }));

  // The output folder is emptied once, by the first build that runs. The widgets build never empties it:
  // it completes a package the other builds wrote.
  if (selected[0] !== 'widgets') {
    configs[0].plugins = [
      del({ targets: [`${outDir.replace(/\\/g, '/')}/*`], runOnce: true, force: true }),
      ...(configs[0].plugins ?? []),
    ];
  }

  return configs;
}

/**
 * Specifiers the host provides through its import map (client build).
 *
 * @param {string} id
 * @returns {boolean}
 */
function isHostSpecifier(id) {
  if (id === PLUGIN_API_SPECIFIER) return false; // a virtual module of the kit, bundled
  return (
    id === 'svelte' ||
    id.startsWith('svelte/') ||
    id === 'svelte-i18n' ||
    id === '@panomc/sdk' ||
    id.startsWith('@panomc/sdk/')
  );
}

/**
 * Writes `manifest.json` (the list of emitted files) into the output folder of a build.
 *
 * @param {string} name
 * @returns {import('rollup').Plugin}
 */
function manifestPlugin(name) {
  return {
    name: `pano-manifest-${name}`,
    writeBundle(options, bundle) {
      fs.writeFileSync(
        path.join(options.dir, 'manifest.json'),
        JSON.stringify(Object.keys(bundle), null, 2),
      );
    },
  };
}

/**
 * Nearest `node_modules/<name>` folder above `from`.
 *
 * @param {string} from
 * @param {string} name package name
 * @returns {string | null}
 */
export function findPackageDir(from, name) {
  let dir = path.resolve(from);

  for (;;) {
    const candidate = path.join(dir, 'node_modules', name);

    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate);

    const parent = path.dirname(dir);

    if (parent === dir) return null;

    dir = parent;
  }
}

/**
 * Loads `pluginApi` from the sdk's `build/plugin-api-rollup.js`, when the sdk has it.
 *
 * @param {string | null} sdkDir
 * @returns {Promise<((pluginId: string) => import('rollup').Plugin) | null>}
 */
async function loadPluginApiFactory(sdkDir) {
  if (!sdkDir) return null;

  const file = path.join(sdkDir, 'build/plugin-api-rollup.js');

  if (!fs.existsSync(file)) return null;

  const module = await import(pathToFileURL(file).href);

  return typeof module.pluginApi === 'function' ? module.pluginApi : null;
}

/**
 * The svelte COMPILER a plugin builds with must match the runtime the Pano host serves in the browser
 * (compiled output and runtime are only compatible at the exact same version). @panomc/sdk pins the
 * version, so the plugin must not declare svelte itself.
 *
 * @param {{ root: string, sdkDir: string | null }} input
 */
export function checkSvelteVersion({ root, sdkDir }) {
  /** @param {string} file */
  const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

  let sdkPin = null;
  let installed = null;
  let ownDecl = null;

  try {
    if (sdkDir) sdkPin = read(path.join(sdkDir, 'package.json')).dependencies?.svelte ?? null;
  } catch {
    // sdk not readable: rollup fails on its own with a clearer error.
  }

  const svelteDir = findPackageDir(root, 'svelte');

  try {
    const dir = svelteDir ?? (sdkDir ? path.join(sdkDir, 'node_modules/svelte') : null);

    if (dir) installed = read(path.join(dir, 'package.json')).version;
  } catch {
    // svelte missing entirely: rollup-plugin-svelte fails on its own.
  }

  try {
    const own = read(path.join(root, 'package.json'));

    ownDecl =
      own.dependencies?.svelte ??
      own.devDependencies?.svelte ??
      own.peerDependencies?.svelte ??
      null;
  } catch {
    // no readable package.json: nothing to validate.
  }

  if (ownDecl) {
    console.warn(
      `[pano] WARNING: package.json declares svelte ${ownDecl}, but the svelte version comes from @panomc/sdk. ` +
        `A local override can drift from the Pano host runtime and break the plugin at hydration: remove the svelte entry and re-install.`,
    );
  }

  // The sdk pins an exact version; only enforce when it is one (not a range).
  if (sdkPin && /^\d/.test(sdkPin) && installed && installed !== sdkPin) {
    throw new Error(
      `[pano] installed svelte is ${installed} but @panomc/sdk requires exactly ${sdkPin}. ` +
        `Compiled plugin output is only compatible with the Pano host runtime at the same version. ` +
        `Remove any svelte override from package.json and re-install.`,
    );
  }

  if (!sdkPin && installed) {
    console.warn(
      `[pano] WARNING: the installed @panomc/sdk does not pin a svelte version; building with svelte ${installed}. ` +
        `Make sure it matches the Pano host runtime version.`,
    );
  }
}

/**
 * Local delivery (`PANO_SDK_DIR`): resolves `@panomc/sdk` and `@panomc/sdk/<subpath>` to files of that
 * folder through its package.json `exports` map, as a published install would.
 *
 * @param {string} sdkDir absolute sdk package folder
 * @returns {import('rollup').Plugin}
 */
function sdkAliasPlugin(sdkDir) {
  /** @type {Record<string, any>} */
  let exportsMap = {};

  try {
    exportsMap = JSON.parse(fs.readFileSync(path.join(sdkDir, 'package.json'), 'utf8')).exports ?? {};
  } catch {
    // no exports map: fall back to plain file paths below.
  }

  /** @param {any} target */
  const pick = (target) => {
    if (typeof target === 'string') return target;
    if (!target || typeof target !== 'object') return null;

    for (const key of ['svelte', 'import', 'default']) {
      if (key in target) {
        const found = pick(target[key]);

        if (found) return found;
      }
    }

    return null;
  };

  return {
    name: 'pano-sdk-alias',
    resolveId(source) {
      if (source !== '@panomc/sdk' && !source.startsWith('@panomc/sdk/')) return null;

      const subpath = source === '@panomc/sdk' ? '.' : `./${source.slice('@panomc/sdk/'.length)}`;
      let target = pick(exportsMap[subpath]);

      if (!target) {
        for (const [pattern, value] of Object.entries(exportsMap)) {
          const star = pattern.indexOf('*');

          if (star < 0) continue;

          const prefix = pattern.slice(0, star);
          const suffix = pattern.slice(star + 1);

          if (subpath.startsWith(prefix) && subpath.endsWith(suffix) && subpath.length >= prefix.length + suffix.length) {
            const matched = subpath.slice(prefix.length, subpath.length - suffix.length);
            const picked = pick(value);

            if (picked) {
              target = picked.replace('*', matched);
              break;
            }
          }
        }
      }

      if (!target) return null;

      return path.resolve(sdkDir, target);
    },
  };
}

export { panoEntry, panoControllersModule } from './entry.js';
export { panoViews } from './views.js';
export { panoRules } from './rules.js';
export { panoHelpers } from './helpers.js';
export { panoStamp } from './stamp.js';
export { panoControllers } from './controllers.js';
export { panoMeta } from './meta.js';
export { panoTypes } from './types.js';
export { panoSamples } from './samples.js';
export { panoWidgets } from './widgets.js';
export { panoClientGen } from './client-gen.js';
export { readLock, writeLockSection, diffSection } from './lock.js';
export { panoSemanticClasses } from '../styles/semantic-classes.js';
export { panoFallbackCss } from '../styles/fallback-css.js';
export { panoPluginCss } from '../styles/plugin-css.js';
