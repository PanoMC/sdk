// The widget runtime build (doc 06 section 3.3): one rollup run -> `dist/runtime/`.
//
//   svelte/*.js, svelte-i18n.js     one entry per `svelte*` name of RUNTIME_SPECIFIERS (same file names)
//   host/*.js                       one entry per `@panomc/sdk` facade (src/ of this package)
//   loader.js                       the page loader (scripts/loader.js)
//   chunks/chunk-<hash>.js          code the entries share
//   css/, webfonts/, runtime.json   the token defaults, the FontAwesome Free fallback sheet, the file table
//
// `preserveEntrySignatures: 'strict'` plus the entries being the Svelte modules themselves means every widget bundle, which imports
// `svelte/...` by relative URL, runs on the one Svelte instance of the page. `dist/` is git-ignored.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import svelte from 'rollup-plugin-svelte';
import { PACKAGE_DIR, RUNTIME_FILES, runtimeInput } from './scripts/runtime-map.js';

const require = createRequire(import.meta.url);
const root = resolve(PACKAGE_DIR);
export const OUT_DIR = join(root, 'dist/runtime');
const TOKENS_CSS = resolve(root, '../sdk/core/css/pano-tokens.css');

/** FontAwesome Free comes with `@panomc/theme-core` (doc 03 section 4.6); the package folder is the one to look it up from. */
function fontAwesomeDir() {
  for (const from of [resolve(root, '../theme-core/package.json'), resolve(root, 'package.json')]) {
    try {
      return dirname(createRequire(from).resolve('@fortawesome/fontawesome-free/package.json'));
    } catch {
      /* next */
    }
  }
  throw new Error('widget-host: @fortawesome/fontawesome-free is not installed (it is a dependency of @panomc/theme-core)');
}

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
    .sort();

/**
 * `svelte-i18n` imports `deepmerge`, which only ships CommonJS (`module.exports = deepmerge_1;` is its last line). The kit has no
 * commonjs plugin to install, so this one file is turned into an ES module here; any other CommonJS dependency fails the build.
 */
function deepmergeEsm() {
  return {
    name: 'pano-deepmerge-esm',
    transform(code, id) {
      if (!/[\\/]deepmerge[\\/]dist[\\/]cjs\.js$/.test(id)) return null;
      if (!/module\.exports = deepmerge_1;\s*$/.test(code)) this.error('deepmerge no longer ends in `module.exports = deepmerge_1;`: update deepmergeEsm() in rollup.config.js');
      return { code: code.replace(/module\.exports = deepmerge_1;\s*$/, 'export default deepmerge_1;\n'), map: null };
    },
  };
}

/** Wipes the output folder first; after the write copies the static files and writes `runtime.json`. */
function runtimeAssets() {
  return {
    name: 'pano-runtime-assets',
    buildStart() {
      rmSync(OUT_DIR, { recursive: true, force: true });
    },
    writeBundle() {
      const fa = fontAwesomeDir();
      mkdirSync(join(OUT_DIR, 'css'), { recursive: true });
      cpSync(TOKENS_CSS, join(OUT_DIR, 'css/pano-tokens.css'));
      cpSync(join(fa, 'css/all.min.css'), join(OUT_DIR, 'css/pano-fallback-icons.css'));
      cpSync(join(fa, 'webfonts'), join(OUT_DIR, 'webfonts'), { recursive: true });

      const svelteVersion = JSON.parse(readFileSync(require.resolve('svelte/package.json'), 'utf8')).version;
      const hash = createHash('sha256');
      const files = walk(OUT_DIR).map((f) => relative(OUT_DIR, f).split('\\').join('/'));
      for (const f of files) hash.update(f).update(readFileSync(join(OUT_DIR, f)));

      writeFileSync(
        join(OUT_DIR, 'runtime.json'),
        JSON.stringify({ format: 1, svelte: svelteVersion, hash: hash.digest('hex').slice(0, 16), specifiers: RUNTIME_FILES, files }, null, 2) + '\n',
      );
    },
  };
}

/** @type {import('rollup').RollupOptions} */
export default {
  input: runtimeInput(join(root, 'scripts/loader.js')),
  preserveEntrySignatures: 'strict',
  output: {
    dir: OUT_DIR,
    format: 'es',
    entryFileNames: '[name].js',
    chunkFileNames: 'chunks/chunk-[hash].js',
    hoistTransitiveImports: false,
    generatedCode: 'es2015',
    sourcemap: false,
  },
  plugins: [
    deepmergeEsm(),
    svelte({ emitCss: false, compilerOptions: { dev: false } }),
    nodeResolve({ browser: true, exportConditions: ['browser', 'import', 'default'], dedupe: ['svelte', 'svelte-i18n'] }),
    terser({ module: true, format: { comments: false } }),
    runtimeAssets(),
  ],
  onwarn(warning, warn) {
    if (warning.code === 'CIRCULAR_DEPENDENCY' && /node_modules/.test(warning.message)) return;
    warn(warning);
  },
};
