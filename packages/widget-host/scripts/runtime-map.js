// Which file of `dist/runtime/` stands for which bare specifier (doc 06 section 3.3). The runtime build (`rollup.config.js`),
// the widget target of the plugin kit (relative `output.paths`) and the tests read this one table.
//
//   svelte, svelte/store, svelte/internal/client ...  -> the file names of RUNTIME_SPECIFIERS      `svelte/internal-client.js`
//   svelte-i18n                                       -> `svelte-i18n.js`
//   @panomc/sdk, @panomc/sdk/toasts ...               -> `host/<shim name of RUNTIME_SPECIFIERS>`  `host/toasts.js`, `host/utils-api.js`
//
// plus `loader.js`, `css/pano-tokens.css`, `css/pano-fallback-icons.css`, `webfonts/*` and `runtime.json` (not specifiers).
import { fileURLToPath } from 'node:url';
import { RUNTIME_SPECIFIERS } from '../../theme-core/src/kit/specifiers.js';
import { SPECIFIER_MODULES } from '../src/index.js';

export const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
export const SRC_DIR = fileURLToPath(new URL('../src/', import.meta.url));

/** Specifier -> file of the runtime directory, for every `svelte*` name and every `@panomc/sdk` facade. */
export const RUNTIME_FILES = Object.freeze(
  Object.fromEntries(
    Object.entries(RUNTIME_SPECIFIERS).map(([specifier, file]) => {
      if (specifier === 'svelte-i18n') return [specifier, 'svelte-i18n.js'];
      if (file.startsWith('sdk/')) return [specifier, `host/${file.slice('sdk/'.length)}`];
      return [specifier, file];
    }),
  ),
);

/** Specifier -> the source file of this package that implements it (`@panomc/sdk*` only). */
export const HOST_SOURCES = Object.freeze(
  Object.fromEntries(Object.entries(SPECIFIER_MODULES).map(([specifier, file]) => [specifier, SRC_DIR + file])),
);

/** Rollup `input` of the runtime build: chunk name (file without `.js`) -> module to resolve. */
export function runtimeInput(loaderFile) {
  /** @type {Record<string, string>} */
  const input = {};
  for (const [specifier, file] of Object.entries(RUNTIME_FILES)) {
    input[file.replace(/\.js$/, '')] = HOST_SOURCES[specifier] ?? specifier;
  }
  input.loader = loaderFile;
  return input;
}

/**
 * Relative URL of a runtime file seen from a widget module that sits in `.../_/ui/widgets/` of a plugin
 * (`/api/v1/plugins/<id>/_/ui/widgets/` -> five levels up is `/api/v1/`, doc 06 section 3.3).
 * @param {string} specifier
 */
export function widgetImportPath(specifier) {
  const file = RUNTIME_FILES[specifier];
  if (!file) throw new Error(`no runtime file for ${specifier}`);
  return `../../../../../widgets/runtime/${file}`;
}
