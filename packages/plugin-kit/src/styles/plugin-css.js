/**
 * A plugin's own CSS (doc 03 section 3.1): the `<style>` blocks of the components that end up in the
 * client bundle are concatenated into `client/plugin.css`, wrapped in `@layer pano-plugin`, and the
 * package index records `styles.own`. A plugin with no `<style>` emits no file.
 *
 * The CSS is taken in one of two ways, so the preset does not have to be switched:
 *
 *  - `rollup-plugin-svelte` with `emitCss: true` hands every component's CSS to rollup as a virtual
 *    `<Component>.css` module; this plugin collects its code and turns the module into an empty one;
 *  - with `emitCss: false` (what the preset uses today) the CSS of a component is thrown away by
 *    that plugin, so this plugin compiles the component's `<style>` itself, with the same file name
 *    (`path.relative(process.cwd(), id)`) and the same options (`css: 'external'`), which gives the
 *    same Svelte hash class as the compiled markup carries.
 *
 * `plugin-css.js` also owns the small registry that `fallback-css.js` shares: the two files of the
 * package (`fallback.css`, `plugin.css`) are hashed together into `styles.hash`.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { compile } from 'svelte/compiler';
import { getBuildContext } from '../rollup/meta.js';
import { addRootClass } from './semantic-classes.js';

/** Package path of the fallback sheet, as `pano-plugin.json` states it. */
export const FALLBACK_PATH = 'client/fallback.css';
/** Package path of the plugin's own sheet, as `pano-plugin.json` states it. */
export const OWN_PATH = 'client/plugin.css';

/**
 * @typedef {object} StyleRecord
 * @property {string} [fallback] content of client/fallback.css
 * @property {string} [own] content of client/plugin.css
 * @property {boolean} [icons]
 */

/** The files of the build that is running, by absolute plugin root. @type {Map<string, StyleRecord>} */
const records = new Map();

/** @param {string} root @returns {StyleRecord} */
function recordOf(root) {
  const key = path.resolve(root);

  if (!records.has(key)) records.set(key, {});

  return /** @type {StyleRecord} */ (records.get(key));
}

/**
 * First 8 hex digits of the sha1 over the fallback sheet and the plugin's own sheet (those that exist).
 *
 * @param {{ fallback?: string, own?: string }} files
 * @returns {string}
 */
export function styleHash(files) {
  return createHash('sha1')
    .update(files.fallback ?? '')
    .update(files.own ?? '')
    .digest('hex')
    .slice(0, 8);
}

/**
 * Rewrites `styles` of the shared build context from the files recorded so far.
 *
 * @param {string} root
 */
function syncContext(root) {
  const record = recordOf(root);
  const context = getBuildContext(root);

  if (record.fallback === undefined && record.own === undefined) {
    context.styles = null;

    return;
  }

  /** @type {Record<string, any>} */
  const styles = {};

  if (record.fallback !== undefined) styles.fallback = FALLBACK_PATH;
  if (record.own !== undefined) styles.own = OWN_PATH;

  styles.hash = styleHash(record);

  if (record.icons !== undefined) styles.icons = record.icons;

  context.styles = /** @type {any} */ (styles);
}

/**
 * Records one emitted style file (and `icons` for the fallback sheet) for `pano-plugin.json`.
 *
 * @param {string} root plugin root
 * @param {'fallback' | 'own'} kind
 * @param {string} content
 * @param {{ icons?: boolean }} [extra]
 */
export function recordStyleFile(root, kind, content, extra = {}) {
  const record = recordOf(root);

  record[kind] = content;

  if (kind === 'fallback' && extra.icons !== undefined) record.icons = extra.icons;

  syncContext(root);
}

/**
 * Forgets one style file (start of a build cycle).
 *
 * @param {string} root plugin root
 * @param {'fallback' | 'own'} kind
 */
export function clearStyleFile(root, kind) {
  const record = recordOf(root);

  delete record[kind];

  if (kind === 'fallback') delete record.icons;

  syncContext(root);
}

/** @param {string} id @returns {string} */
const withoutQuery = (id) => id.split('?')[0].replace(/\\/g, '/');

/**
 * The CSS of one component, compiled the way rollup-plugin-svelte compiles it.
 *
 * @param {string} source
 * @param {string} file absolute path
 * @param {string} ns
 * @returns {string | null} null when the component has no CSS or cannot be compiled (the real compile reports it)
 */
export function componentCss(source, file, ns) {
  if (!/<style[\s>]/.test(source)) return null;

  let code = source;

  if (!file.includes('/node_modules/')) {
    try {
      // The build adds the root class to the markup before the compile; a selector on it must survive.
      code = addRootClass(source, { ns, view: path.basename(file, '.svelte') }).code;
    } catch {
      code = source;
    }
  }

  try {
    const compiled = compile(code, {
      filename: path.relative(process.cwd(), file),
      generate: 'client',
      css: 'external',
    });
    const css = compiled.css?.code?.trim();

    return css ? css : null;
  } catch {
    return null;
  }
}

/**
 * Wraps component sheets into the `pano-plugin` layer.
 *
 * @param {[string, string][]} entries [relative path, css] in output order
 * @returns {string} empty when there is nothing
 */
export function layerOwnCss(entries) {
  const parts = entries.filter(([, css]) => css.trim()).map(([name, css]) => `/* ${name} */\n${css.trim()}`);

  if (parts.length === 0) return '';

  return `@layer pano-plugin {\n${parts.join('\n\n')}\n}\n`;
}

/**
 * Client-build plugin: collects the component CSS and emits `plugin.css` (doc 03 section 3.1).
 *
 * @param {{ ns: string, root?: string, outDir?: string, side?: string }} options
 * @returns {import('rollup').Plugin}
 */
export function panoPluginCss(options) {
  if (options?.side !== undefined && options.side !== 'client') return { name: 'pano-plugin-css' };

  const root = path.resolve(options?.root ?? process.cwd());
  const ns = options?.ns ?? 'plugin';
  /** @type {Map<string, string>} svelte file (absolute, slashes) -> css */
  const components = new Map();

  return {
    name: 'pano-plugin-css',

    buildStart() {
      components.clear();
      clearStyleFile(root, 'own');
    },

    transform(code, id) {
      const file = withoutQuery(id);

      if (file.endsWith('.svelte')) {
        const css = componentCss(code, file, ns);

        if (css) components.set(file, css);

        return null;
      }

      // emitCss: true -> rollup-plugin-svelte's virtual `<Component>.css` module
      if (file.endsWith('.css')) {
        const sibling = file.replace(/\.css$/, '.svelte');

        if (fs.existsSync(sibling) && !fs.existsSync(file)) {
          if (code.trim()) components.set(sibling, code);

          return { code: '', map: null };
        }
      }

      return null;
    },

    generateBundle() {
      const entries = [...components.entries()]
        .map(([file, css]) => [path.relative(root, file).replace(/\\/g, '/'), css])
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      const source = layerOwnCss(/** @type {[string, string][]} */ (entries));

      if (!source) return;

      this.emitFile({ type: 'asset', fileName: 'plugin.css', source });
      recordStyleFile(root, 'own', source);
    },
  };
}
