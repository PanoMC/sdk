/**
 * @panomc/plugin-kit: build tooling for Pano plugins (rollup preset `panoPlugin()`,
 * the `pano-plugin` CLI and the controller core). This entry stays free of rollup and
 * svelte imports so it loads anywhere; the preset lives under `@panomc/plugin-kit/rollup`
 * and the controller core under `@panomc/plugin-kit/controller`.
 */
export {
  loadConfig,
  namespaceOf,
  readProperty,
  PLUGIN_ID_PREFIX,
  RESERVED_NAMESPACES,
  DEFAULT_VIEW_DIRS,
} from './config.js';
export {
  readLock,
  writeLockSection,
  diffSection,
  lockPath,
  LOCK_FILE,
  LOCK_FORMAT,
} from './rollup/lock.js';
