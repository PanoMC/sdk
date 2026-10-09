import { rollup } from 'rollup';
import nodeResolve from '@rollup/plugin-node-resolve';
import svelte from 'rollup-plugin-svelte';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, rmSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const sdkDir = resolve(here, '../../packages/sdk');

/** `@panomc/sdk/<sub>` to the workspace source file (what the host runtime shims stand for). */
const SDK_FILES = {
  '@panomc/sdk/views': join(sdkDir, 'src/views.js'),
  '@panomc/sdk/internal': join(sdkDir, 'src/internal/index.js'),
};

const sdkAlias = ({ external }) => ({
  name: 'spike-sdk',
  resolveId(id) {
    return SDK_FILES[id] ? { id: SDK_FILES[id], external } : null;
  },
});

/** Svelte kept external as the exact file the test itself imports, so the theme side shares the workspace instance. */
const sharedSvelte = () => ({
  name: 'spike-shared-svelte',
  resolveId(id) {
    if (id === 'svelte' || id.startsWith('svelte/')) return { id: Bun.resolveSync(id, sdkDir), external: true };

    return null;
  },
});

const svelteFor = (generate) =>
  svelte({ emitCss: false, compilerOptions: { generate, css: 'external' } });

const resolver = (browser) =>
  nodeResolve({
    browser,
    exportConditions: browser ? ['browser'] : [],
    modulePaths: [join(sdkDir, 'node_modules')],
    dedupe: ['svelte'],
  });

async function bundle(config, file) {
  const build = await rollup({ onwarn: () => {}, ...config });

  await build.write({ file, format: 'es', makeAbsoluteExternalsRelative: false, sourcemap: false });
  await build.close();
}

/**
 * Builds the three bundles of the spike into `dist/`:
 *  - `plugin.server.mjs`: the plugin, no externals (its own Svelte server runtime and its own SDK copy), like market's
 *    server build;
 *  - `theme.server.mjs`: the theme side, Svelte and SDK left as the workspace files;
 *  - `client.mjs`: plugin and theme together with one Svelte (browser).
 *
 * @returns {Promise<{ pluginServer: string, themeServer: string, client: string }>}
 */
export async function buildSpike(outDir = join(here, 'dist')) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const out = {
    pluginServer: join(outDir, 'plugin.server.mjs'),
    themeServer: join(outDir, 'theme.server.mjs'),
    client: join(outDir, 'client.mjs'),
  };

  await bundle(
    {
      input: join(here, 'src/plugin/index.js'),
      plugins: [sdkAlias({ external: false }), svelteFor('server'), resolver(false)],
    },
    out.pluginServer,
  );

  await bundle(
    {
      input: join(here, 'src/theme/entry.js'),
      plugins: [sdkAlias({ external: true }), sharedSvelte(), svelteFor('server'), resolver(false)],
    },
    out.themeServer,
  );

  await bundle(
    {
      input: join(here, 'src/client/entry.js'),
      plugins: [sdkAlias({ external: false }), svelteFor('client'), resolver(true)],
    },
    out.client,
  );

  return out;
}

if (import.meta.main) {
  console.log(await buildSpike());
}
