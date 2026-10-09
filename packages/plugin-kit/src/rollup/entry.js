import fs from 'node:fs';
import path from 'node:path';

/**
 * Entry wrapper and the `pano:controllers` virtual module (doc 02 section 4, doc 01 section 2).
 *
 * The build input is the virtual module `pano:entry`, a pure re-export facade over the wrapper
 * (see the long note in `index.js`). The wrapper imports the author's `src/main.js` (or, when it is
 * missing, a default `export default class extends PanoPlugin {}`), exports `panoSdk = 2` and
 * makes `onLoad()` register, in this order:
 *
 *   1. `this.pano.controllers?.register(pluginId, namespace, controllers)`
 *   2. `this.pano.views?.add(views)`
 *   3. the author's own `onLoad`
 */

/** Virtual module ids. */
export const ENTRY_ID = 'pano:entry';
export const VIEWS_ID = 'pano:views';
export const CONTROLLERS_ID = 'pano:controllers';

/** Resolved (internal) ids; the build's `manualChunks` uses them to keep the entry in one shared chunk. */
export const FACADE_RESOLVED_ID = '\0pano-entry-facade';
export const WRAPPER_RESOLVED_ID = '\0pano-entry-wrapper';
export const DEFAULT_MAIN_RESOLVED_ID = '\0pano-default-main';
const VIEWS_FALLBACK_RESOLVED_ID = '\0pano-views-fallback';
const CONTROLLERS_RESOLVED_ID = '\0pano-controllers';

/** Default controllers folder (relative to the plugin root). */
export const DEFAULT_CONTROLLERS_DIR = 'src/theme/controllers';

/** Files of the controllers folder that are never controllers. */
const NOT_CONTROLLERS = new Set(['types.js']);

/**
 * @param {string} file
 * @returns {string} forward-slash form, safe inside a JS string on every platform
 */
function posix(file) {
  return file.replace(/\\/g, '/');
}

/**
 * The public controllers of a folder: every `*.js` file directly in it, except `_*.js` and
 * `types.js`; sub-folders are private code and are skipped. Sorted by name.
 *
 * @param {string} dir absolute folder
 * @returns {{ name: string, file: string }[]} `name` = file name without `.js`
 */
export function listControllerFiles(dir) {
  let entries;

  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.js') &&
        !entry.name.startsWith('_') &&
        !NOT_CONTROLLERS.has(entry.name),
    )
    .map((entry) => ({ name: entry.name.slice(0, -3), file: path.join(dir, entry.name) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Source of the virtual module `pano:controllers`: a default export mapping controller name to
 * the file's default export.
 *
 * @param {{ name: string, file: string }[]} files
 * @returns {string}
 */
export function controllersModuleSource(files) {
  const imports = files.map(
    (item, index) => `import controller${index} from ${JSON.stringify(posix(item.file))};`,
  );
  const entries = files.map((item, index) => `  ${JSON.stringify(item.name)}: controller${index},`);

  return `${imports.join('\n')}${imports.length ? '\n' : ''}export default {\n${entries.join('\n')}${entries.length ? '\n' : ''}};\n`;
}

/**
 * Source of the entry wrapper (doc 01 section 2).
 *
 * @param {{ pluginId: string, namespace: string, mainId: string }} input `mainId` = the module the
 *   author's entry resolves to (the real `src/main.js` or the default one)
 * @returns {string}
 */
export function wrapperSource({ pluginId, namespace, mainId }) {
  const main = JSON.stringify(posix(mainId));

  return [
    `import Author from ${main};`,
    `import views from ${JSON.stringify(VIEWS_ID)};`,
    `import controllers from ${JSON.stringify(CONTROLLERS_ID)};`,
    `export * from ${main};`,
    '',
    '// Pano SDK level of this bundle: the host loads modules without it as legacy plugins.',
    'export const panoSdk = 2;',
    '',
    `const pluginId = ${JSON.stringify(pluginId)};`,
    `const namespace = ${JSON.stringify(namespace)};`,
    '',
    'export default class extends Author {',
    '  onLoad(...args) {',
    '    // Order is part of the contract: controllers, then views, then the author\'s onLoad.',
    '    this.pano?.controllers?.register(pluginId, namespace, controllers);',
    '    this.pano?.views?.add(views);',
    '',
    '    return super.onLoad?.(...args);',
    '  }',
    '}',
    '',
  ].join('\n');
}

/** Source of the entry used when the plugin has no `src/main.js`. */
export function defaultMainSource() {
  return [
    "import { PanoPlugin } from '@panomc/sdk';",
    '',
    'export default class extends PanoPlugin {}',
    '',
  ].join('\n');
}

/**
 * Entry wrapper plugin: resolves `pano:entry` (facade over the wrapper), the wrapper itself, the
 * default `src/main.js`, and a last-resort empty `pano:views` module (used only while no other plugin
 * resolves `pano:views`; `panoViews()` takes precedence).
 *
 * @param {{ pluginId: string, namespace: string, controllersDir?: string, root?: string, main?: string }} [options]
 *   `main` = path of the author's entry, default `<root>/src/main.js`
 * @returns {import('rollup').Plugin}
 */
export function panoEntry(options = /** @type {any} */ ({})) {
  const { pluginId, namespace } = options;
  const root = path.resolve(options.root ?? process.cwd());
  const mainFile = path.resolve(root, options.main ?? 'src/main.js');

  return {
    name: 'pano-entry',

    async resolveId(source, importer, resolveOptions) {
      if (source === ENTRY_ID) return FACADE_RESOLVED_ID;

      if (
        source === WRAPPER_RESOLVED_ID ||
        source === DEFAULT_MAIN_RESOLVED_ID ||
        source === FACADE_RESOLVED_ID
      ) {
        return source;
      }

      if (source === VIEWS_ID) {
        // Last resort only: when no other plugin (panoViews) resolves pano:views, the plugin has
        // no views and the module is empty.
        const other = await this.resolve(source, importer, {
          ...resolveOptions,
          skipSelf: true,
        });

        return other ?? VIEWS_FALLBACK_RESOLVED_ID;
      }

      return null;
    },

    load(id) {
      if (id === FACADE_RESOLVED_ID) {
        return (
          `export * from ${JSON.stringify(WRAPPER_RESOLVED_ID)};\n` +
          `export { default } from ${JSON.stringify(WRAPPER_RESOLVED_ID)};\n`
        );
      }

      if (id === WRAPPER_RESOLVED_ID) {
        if (!pluginId || !namespace) {
          this.error('[pano-plugin] panoEntry needs pluginId and namespace');
        }

        const exists = fs.existsSync(mainFile);

        if (exists) this.addWatchFile(mainFile);

        return wrapperSource({
          pluginId,
          namespace,
          mainId: exists ? mainFile : DEFAULT_MAIN_RESOLVED_ID,
        });
      }

      if (id === DEFAULT_MAIN_RESOLVED_ID) return defaultMainSource();

      if (id === VIEWS_FALLBACK_RESOLVED_ID) return 'export default [];\n';

      return null;
    },
  };
}

/**
 * Virtual module `pano:controllers`: the default export of every file directly under
 * `src/theme/controllers` (`_*.js`, `types.js` and sub-folders skipped), as `{ [fileName]: definition }`.
 *
 * @param {{ dir?: string, root?: string }} [options] controllers folder (default
 *   `src/theme/controllers`, relative to `root`)
 * @returns {import('rollup').Plugin}
 */
export function panoControllersModule(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const dir = path.resolve(root, options.dir ?? DEFAULT_CONTROLLERS_DIR);

  return {
    name: 'pano-controllers-module',

    resolveId: {
      order: 'pre',
      handler(source) {
        if (source === CONTROLLERS_ID) return CONTROLLERS_RESOLVED_ID;
        return null;
      },
    },

    load(id) {
      if (id !== CONTROLLERS_RESOLVED_ID) return null;

      const files = listControllerFiles(dir);

      if (fs.existsSync(dir)) this.addWatchFile(dir);

      for (const item of files) {
        const text = fs.readFileSync(item.file, 'utf8');

        if (!/\bexport\s+default\b|\bas\s+default\b/.test(text)) {
          this.error(
            `${path.relative(root, item.file)} has no default export: every file directly in ${posix(path.relative(root, dir))}/ is a public controller, so it must "export default defineController({...})"; rename a private helper to _${path.basename(item.file)} or move it into a sub-folder`,
          );
        }
      }

      return controllersModuleSource(files);
    },
  };
}
