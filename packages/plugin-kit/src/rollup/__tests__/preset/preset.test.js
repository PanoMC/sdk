import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rollup } from 'rollup';
import { panoPlugin } from '../../index.js';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import {
  controllersModuleSource,
  listControllerFiles,
  wrapperSource,
} from '../../entry.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const themeCore = path.resolve(here, '../../../../../..');
const fixture = path.join(themeCore, 'test-fixtures/plugin-min');
const sdkDir = path.join(themeCore, 'packages/sdk');

/** @type {string} */
let out;
/** @type {string | undefined} */
let previousSdkDir;

beforeAll(() => {
  out = fs.mkdtempSync(path.join(os.tmpdir(), 'pano-preset-'));
  previousSdkDir = process.env.PANO_SDK_DIR;
  process.env.PANO_SDK_DIR = sdkDir;
});

afterAll(() => {
  if (previousSdkDir === undefined) delete process.env.PANO_SDK_DIR;
  else process.env.PANO_SDK_DIR = previousSdkDir;

  fs.rmSync(out, { recursive: true, force: true });
});

/** Stand-in for panoViews() (a later unit): `pano:views` imports the fixture's one view. */
function viewsStandIn() {
  const id = '\0test-views';

  return {
    name: 'test-views',
    resolveId: (source) => (source === 'pano:views' ? id : null),
    load: (loadId) =>
      loadId === id
        ? `import HelloPage from ${JSON.stringify(path.join(fixture, 'src/theme/views/HelloPage.svelte'))};\n` +
          `export default [{ name: 'min:HelloPage', component: () => Promise.resolve({ default: HelloPage }) }];\n`
        : null,
  };
}

/**
 * @param {Parameters<typeof panoPlugin>[0]} options
 * @returns {Promise<import('rollup').RollupOptions[]>}
 */
function configs(options = {}) {
  return panoPlugin({ root: fixture, outDir: out, minify: false, ...options });
}

/** Builds every config and returns the written files by relative path. */
async function build(options = {}) {
  for (const config of await configs(options)) {
    const bundle = await rollup(config);

    await bundle.write(/** @type {any} */ (config.output));
    await bundle.close();
  }

  /** @type {Record<string, string>} */
  const files = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);

      if (entry.isDirectory()) walk(file);
      else files[path.relative(out, file)] = fs.readFileSync(file, 'utf8');
    }
  };

  walk(out);

  return files;
}

describe('panoPlugin() on the plugin-min fixture', () => {
  test('returns client, server and controllers builds (no widgets without a widget view); the client build carries the cleaner', async () => {
    const list = await configs();

    expect(list.map((config) => path.relative(out, /** @type {any} */ (config.output).dir))).toEqual([
      'client',
      'server',
      'controllers',
    ]);
    expect(list.map((config) => /** @type {any} */ (config.output).entryFileNames)).toEqual([
      'client.mjs',
      'server.mjs',
      'controllers.mjs',
    ]);
    expect(list.map((config) => (config.plugins ?? []).some((plugin) => plugin && plugin.name === 'delete'))).toEqual([
      true,
      false,
      false,
    ]);
  });

  test('side picks one build; an unknown side is refused', async () => {
    expect((await configs({ side: 'client' })).length).toBe(1);
    expect((await configs({ side: 'server' })).length).toBe(1);
    await expect(configs({ side: /** @type {any} */ ('panel') })).rejects.toThrow(/side/);
  });

  test('builds server and client bundles; the wrapper registers controllers before views, then onLoad', async () => {
    const files = await build({ plugins: [viewsStandIn()] });

    for (const entry of ['server/server.mjs', 'client/client.mjs', 'controllers/controllers.mjs']) {
      expect(files[entry], entry).toBeDefined();
    }

    expect(JSON.parse(files['server/manifest.json'])).toContain('server.mjs');
    expect(JSON.parse(files['client/manifest.json'])).toContain('client.mjs');

    for (const side of ['server', 'client']) {
      const main = Object.entries(files).find(
        ([name]) => name.startsWith(`${side}/main-`) && name.endsWith('.js'),
      );

      expect(main, `${side} main chunk`).toBeDefined();

      const code = main[1];
      const controllers = code.indexOf('controllers?.register(pluginId, namespace, controllers)');
      const views = code.indexOf('views?.add(views)');
      const author = code.indexOf('super.onLoad');

      expect(controllers).toBeGreaterThan(-1);
      expect(views).toBeGreaterThan(controllers);
      expect(author).toBeGreaterThan(views);
      expect(code).toContain('panoSdk = 2');
      expect(code).toContain('"pano-plugin-min"');
      expect(code).toContain('"min"');
      // the controller and its default export reached the bundle
      expect(code).toContain('greeter');
    }

    // the facade is a pure re-export, with no state of its own
    expect(files['client/client.mjs']).toMatch(/^export \{[^}]*\} from '\.\/main-[\w-]+\.js';/m);
    expect(files['client/client.mjs']).not.toContain('class ');
  });

  test('client keeps the host specifiers external, server bundles them', async () => {
    const files = await build({ plugins: [viewsStandIn()] });
    const clientCode = Object.entries(files)
      .filter(([name]) => name.startsWith('client/') && name.endsWith('.js'))
      .map(([, code]) => code)
      .join('\n');
    const serverCode = Object.entries(files)
      .filter(([name]) => name.startsWith('server/') && name.endsWith('.js'))
      .map(([, code]) => code)
      .join('\n');

    expect(clientCode).toMatch(/from ['"]@panomc\/sdk['"]/);
    expect(clientCode).toMatch(/from ['"]svelte\/internal\/client['"]/);
    // the controller core is bundled, never an import of the host
    expect(clientCode).not.toMatch(/from ['"]@panomc\/plugin-kit/);
    expect(clientCode).toContain('function defineController');
    expect(serverCode).not.toMatch(/from ['"]@panomc\/sdk['"]/);
    expect(serverCode).not.toMatch(/from ['"]svelte/);
    // the view helper was compiled into both bundles
    expect(clientCode).toContain('Hello, ');
    expect(serverCode).toContain('Hello, ');
  });

  test('without src/main.js the entry is a default class extending PanoPlugin', async () => {
    expect(fs.existsSync(path.join(fixture, 'src/main.js'))).toBe(false);

    const files = await build();
    const main = Object.entries(files).find(([name]) => name.startsWith('client/main-'))[1];

    expect(main).toContain('extends PanoPlugin');
  });

  test('the output folder is emptied by the first build', async () => {
    const stale = path.join(out, 'stale.txt');

    fs.writeFileSync(stale, 'x');
    await build();
    expect(fs.existsSync(stale)).toBe(false);
  });

  test('@panomc/sdk/plugin-api resolves to createPluginApi(<plugin id>) and is bundled, not external', async () => {
    const probe = {
      name: 'test-api-probe',
      resolveId: (source) => (source === 'pano:views' ? '\0test-api-probe' : null),
      load: (id) =>
        id === '\0test-api-probe'
          ? `import { api } from '@panomc/sdk/plugin-api';\nexport default [api];\n`
          : null,
    };
    const list = await configs({ side: 'client', plugins: [probe] });
    const bundle = await rollup(list[0]);
    const { output } = await bundle.generate(/** @type {any} */ (list[0].output));
    const code = output.map((chunk) => ('code' in chunk ? chunk.code : '')).join('\n');

    expect(code).toContain('createPluginApi("pano-plugin-min")');
    expect(code).toMatch(/from ['"]@panomc\/sdk\/utils\/api['"]/);
    expect(code).not.toMatch(/from ['"]@panomc\/sdk\/plugin-api['"]/);
  });

  test('a svelte version that differs from the sdk pin fails the build', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pano-preset-pin-'));

    try {
      const fakeSdk = path.join(dir, 'sdk');

      fs.mkdirSync(path.join(fakeSdk, 'node_modules/svelte'), { recursive: true });
      fs.writeFileSync(
        path.join(fakeSdk, 'package.json'),
        JSON.stringify({ name: '@panomc/sdk', dependencies: { svelte: '5.0.0' } }),
      );
      fs.writeFileSync(
        path.join(fakeSdk, 'node_modules/svelte/package.json'),
        JSON.stringify({ name: 'svelte', version: '5.1.0' }),
      );

      process.env.PANO_SDK_DIR = fakeSdk;

      await expect(panoPlugin({ root: fixture })).rejects.toThrow(/requires exactly 5\.0\.0/);
    } finally {
      process.env.PANO_SDK_DIR = sdkDir;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('pano:controllers and the wrapper source', () => {
  test('lists every default export directly in the folder; _*.js, types.js and sub-folders are skipped', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pano-controllers-'));

    try {
      for (const name of ['cart.js', 'format.js', '_private.js', 'types.js', 'notes.txt']) {
        fs.writeFileSync(path.join(dir, name), 'export default {};\n');
      }

      fs.mkdirSync(path.join(dir, 'nested'));
      fs.writeFileSync(path.join(dir, 'nested/deep.js'), 'export default {};\n');

      const files = listControllerFiles(dir);

      expect(files.map((item) => item.name)).toEqual(['cart', 'format']);

      const source = controllersModuleSource(files);

      expect(source).toContain('"cart": controller0');
      expect(source).toContain('"format": controller1');
      expect(source).not.toContain('_private');
      expect(source).not.toContain('types.js');
      expect(source).not.toContain('deep');
      expect(listControllerFiles(path.join(dir, 'missing'))).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a controller file without a default export is a build error naming the file and the fix', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pano-preset-nodefault-'));

    try {
      fs.cpSync(fixture, dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'src/theme/controllers/broken.js'), 'export const x = 1;\n');

      const list = await panoPlugin({ root: dir, outDir: path.join(dir, 'out'), minify: false, side: 'client' });

      await expect(rollup(list[0])).rejects.toThrow(/broken\.js has no default export/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the wrapper source calls controllers.register, then views.add, then the author onLoad', () => {
    const source = wrapperSource({ pluginId: 'pano-plugin-min', namespace: 'min', mainId: '/x/src/main.js' });
    const register = source.indexOf('this.pano?.controllers?.register(pluginId, namespace, controllers)');
    const add = source.indexOf('this.pano?.views?.add(views)');
    const author = source.indexOf('super.onLoad?.(...args)');

    expect(register).toBeGreaterThan(-1);
    expect(add).toBeGreaterThan(register);
    expect(author).toBeGreaterThan(add);
    expect(source).toContain('export const panoSdk = 2;');
    expect(source).toContain('export default class extends Author');
  });
});

describe('panoPlugin() default set and fallback scan', () => {
  /** @param {Record<string, string>} files */
  function copy(files = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pano-preset-copy-'));

    fs.cpSync(fixture, dir, {
      recursive: true,
      filter: (source) => !source.includes(`${path.sep}src${path.sep}main${path.sep}resources`),
    });

    // a copy outside the repo still resolves @panomc/plugin-kit/controller and the toolchain
    fs.symlinkSync(path.join(themeCore, 'node_modules'), path.join(dir, 'node_modules'), 'dir');

    for (const [file, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), content);
    }

    return dir;
  }

  /** @param {import('rollup').RollupOptions[]} list */
  async function write(list) {
    for (const config of list) {
      const bundle = await rollup(config);

      await bundle.write(/** @type {any} */ (config.output));
      await bundle.close();
    }
  }

  test('a class used only under a second view folder reaches fallback.css', async () => {
    const dir = copy({
      'pano.plugin.js': "export default { viewDirs: ['src/theme/views', 'src/theme/extra'] };\n",
      'src/theme/extra/ExtraPage.svelte':
        "<script module>\n  export const view = { path: '/extra' };\n</script>\n\n<div class=\"alert alert-warning\">extra</div>\n",
    });
    const single = copy();

    try {
      await write(await panoPlugin({ root: dir, outDir: path.join(dir, 'out'), minify: false }));
      await write(await panoPlugin({ root: single, outDir: path.join(single, 'out'), minify: false }));

      const css = fs.readFileSync(path.join(dir, 'out/client/fallback.css'), 'utf8');
      const base = fs.readFileSync(path.join(single, 'out/client/fallback.css'), 'utf8');

      expect(css).toContain('alert-warning');
      expect(base).not.toContain('alert-warning');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(single, { recursive: true, force: true });
    }
  });

  test('a widget view puts the widgets build in the default set, last and without the cleaner', async () => {
    const widgets = path.join(themeCore, 'test-fixtures/plugin-widgets');
    const list = await panoPlugin({ root: widgets, outDir: out, minify: false });
    const dirs = list.map((config) => path.relative(out, /** @type {any} */ (config.output).dir));

    expect(dirs[0]).toBe('client');
    expect(dirs[dirs.length - 1]).toBe('widgets');
    expect(dirs).toContain('server');

    const cleaners = list.map((config) => (config.plugins ?? []).some((plugin) => plugin && plugin.name === 'delete'));

    expect(cleaners).toEqual(list.map((_, index) => index === 0));
    expect((await panoPlugin({ root: widgets, outDir: out, side: 'widgets' })).length).toBe(1);
  });

  test('a plain panoPlugin() emits widgets/widgets.json for a plugin with a widget view', async () => {
    const widgets = path.join(themeCore, 'test-fixtures/plugin-widgets');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pano-preset-widgets-'));

    try {
      fs.cpSync(widgets, dir, {
        recursive: true,
        filter: (source) => !source.includes(`${path.sep}src${path.sep}main${path.sep}resources`),
      });
      fs.symlinkSync(path.join(themeCore, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
      await write(await panoPlugin({ root: dir, outDir: path.join(dir, 'out'), minify: false }));

      const json = JSON.parse(fs.readFileSync(path.join(dir, 'out/widgets/widgets.json'), 'utf8'));

      expect(json.format).toBe(1);
      expect(fs.existsSync(path.join(dir, 'out/client/client.mjs'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'out/server/server.mjs'))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the plugin-min build runs under Node (the ES build of the svelte compiler)', () => {
    const rollupFile = pathToFileURL(createRequire(import.meta.url).resolve('rollup')).href;
    const kitFile = pathToFileURL(path.join(here, '../../index.js')).href;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pano-preset-node-'));
    const script = `
      const { rollup } = await import(${JSON.stringify(rollupFile)});
      const { panoPlugin } = await import(${JSON.stringify(kitFile)});
      for (const config of await panoPlugin({ root: ${JSON.stringify(fixture)}, outDir: ${JSON.stringify(path.join(dir, 'out'))}, minify: false })) {
        const bundle = await rollup(config);
        await bundle.write(config.output);
        await bundle.close();
      }
    `;

    try {
      const file = path.join(dir, 'run.mjs');

      fs.writeFileSync(file, script);

      const result = spawnSync('node', [file], {
        encoding: 'utf8',
        env: { ...process.env, PANO_SDK_DIR: sdkDir },
      });

      expect(result.stderr, result.stderr).not.toContain('parse is not a function');
      expect(result.status, result.stderr).toBe(0);
      expect(fs.existsSync(path.join(dir, 'out/client/client.mjs'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'out/server/server.mjs'))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
