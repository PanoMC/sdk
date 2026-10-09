import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { rollup, watch } from 'rollup';
import { panoPlugin } from '../../src/rollup/index.js';
import {
  GREETER_CARD,
  PACKAGE,
  cleanup,
  cli,
  fixtureDir,
  makeProject,
  packageFiles,
  read,
  readJson,
  sdkDir,
  styleFixtureDir,
  write,
} from './helpers.js';

afterAll(cleanup);

/** Every file of a package folder whose name starts with `prefix`, joined. */
function chunks(root, folder, prefix = '') {
  return packageFiles(root)
    .filter((name) => name.startsWith(`${folder}/${prefix}`) && name.endsWith('.js'))
    .map((name) => read(root, `${PACKAGE}/${name}`))
    .join('\n');
}

describe('pano-plugin build on the plugin-min fixture', () => {
  const root = makeProject();
  const first = cli(root, ['build']);

  test('exits 0 and writes every part of the package', () => {
    expect(first.stderr).toBe('');
    expect(first.code).toBe(0);
    expect(first.stdout).toContain('build: 3 bundles written');

    const files = packageFiles(root);

    for (const expected of [
      'pano-plugin.json',
      'contract/views.json',
      'contract/controllers.json',
      'contract/controllers.types.js',
      'contract/src/views/HelloPage.svelte',
      'contract/src/_lib/lib/greet.js',
      'controllers/controllers.mjs',
      'client/client.mjs',
      'client/manifest.json',
      'server/server.mjs',
      'server/manifest.json',
    ]) {
      expect(files, expected).toContain(expected);
    }
  });

  test('one file makes plugin-min:HelloPage with the page /hello in pano:views and contract/views.json', () => {
    const contract = readJson(root, `${PACKAGE}/contract/views.json`);

    expect(contract.namespace).toBe('min');
    expect(contract.pluginId).toBe('pano-plugin-min');
    expect(Object.keys(contract.views)).toEqual(['min:HelloPage']);
    expect(contract.views['min:HelloPage']).toMatchObject({
      kind: 'page',
      contract: 1,
      page: { path: '/hello' },
      props: { name: { required: false } },
    });

    for (const side of ['client', 'server']) {
      const main = chunks(root, side, 'main-');

      expect(main, side).toContain('"min:HelloPage"');
      expect(main, side).toContain('"/hello"');
      expect(main, side).toMatch(/pluginId:\s*["']pano-plugin-min["']/);
    }
  });

  test('the readable copy carries the root class, is not stamped and points at the helper copy', () => {
    const copy = read(root, `${PACKAGE}/contract/src/views/HelloPage.svelte`);

    expect(copy).toContain('<h1 class="min-hello-page">');
    expect(copy).toContain("export const view = { path: '/hello' };");
    expect(copy).toContain("from '../_lib/lib/greet.js'");
    expect(copy).not.toMatch(/version\s*:/);
    // the author's file is never touched
    expect(read(root, 'src/theme/views/HelloPage.svelte')).not.toContain('min-hello-page');
  });

  test('the compiled views carry the root class too, in both bundles', () => {
    expect(chunks(root, 'client', 'HelloPage')).toContain('min-hello-page');
    expect(chunks(root, 'server', 'HelloPage')).toContain('min-hello-page');
  });

  test('pano-plugin.json: the view entry is complete', () => {
    // `styles` is written by the style units (fallback sheet); its content is theirs to test
    const { styles, ...index } = readJson(root, `${PACKAGE}/pano-plugin.json`);

    if (styles) expect(Object.keys(styles).sort()).toEqual(expect.arrayContaining(['fallback', 'hash']));

    expect(index).toEqual({
      format: 1,
      pluginId: 'pano-plugin-min',
      namespace: 'min',
      version: '0.0.0',
      sdk: 2,
      contract: 'contract/views.json',
      controllers: 'contract/controllers.json',
      views: {
        HelloPage: {
          samples: [],
          controllers: {},
          helpers: ['lib/greet.js'],
          roots: ['h1'],
          classes: ['min-hello-page'],
        },
      },
      badges: { controllers: true, samples: false, semanticClasses: false, widgets: false, openapi: false },
    });
  });

  test('contract/controllers.json, controllers.types.js and the helper copy', () => {
    expect(readJson(root, `${PACKAGE}/contract/controllers.json`)).toEqual({
      'min/greeter': {
        version: 1,
        scope: 'app',
        state: ['greeting'],
        actions: ['setGreeting'],
        types: { state: 'GreeterState', actions: 'GreeterActions' },
      },
    });

    const types = read(root, `${PACKAGE}/contract/controllers.types.js`);

    expect(types).toContain('@typedef {{ greeting: any }} GreeterState');
    expect(types).toContain('@typedef {{ setGreeting: (...args: any[]) => any }} GreeterActions');
    expect(types).toContain("'min/greeter': Controller<GreeterState, GreeterActions>");
    expect(types.trimEnd().endsWith('export {};')).toBe(true);

    expect(read(root, `${PACKAGE}/contract/src/_lib/lib/greet.js`)).toBe(
      fs.readFileSync(path.join(fixtureDir, 'src/theme/lib/greet.js'), 'utf8'),
    );
  });

  test('the lock keeps the view (with its root class) and the controller', () => {
    expect(readJson(root, 'pano-plugin.lock.json')).toEqual({
      format: 1,
      views: {
        'min:HelloPage': {
          classes: ['min-hello-page'],
          contract: 1,
          hooks: [],
          props: { name: { required: false } },
          slots: [],
        },
      },
      controllers: { 'min/greeter': { actions: ['setGreeting'], state: ['greeting'], version: 1 } },
    });
  });

  test('the committed lock of the fixture is what the build writes', () => {
    expect(JSON.parse(fs.readFileSync(path.join(fixtureDir, 'pano-plugin.lock.json'), 'utf8'))).toEqual(
      readJson(root, 'pano-plugin.lock.json'),
    );
  });

  test('the client entry is a pure re-export facade (one evaluation of the plugin module)', () => {
    const entry = read(root, `${PACKAGE}/client/client.mjs`).trim();
    // only `export {...} from "./chunk"` and `import "bare"` statements: no code of its own
    const statements = entry.split(/;(?=export|import)/).map((statement) => statement.replace(/;$/, ''));

    expect(statements.length).toBeGreaterThan(1);

    for (const statement of statements) {
      expect(statement, statement).toMatch(/^(export\s*\{[^}]*\}\s*from\s*["'][^"']+["']|import\s*["'][^"']+["'])$/);
    }

    expect(entry).toMatch(/\bas panoSdk\b|\bpanoSdk\b|\bas \w+\b/);
    expect(entry).toMatch(/default/);
    expect(entry).toMatch(/panoSdk/);

    // the module state lives in one query-less chunk the facade and the lazy views share
    const main = packageFiles(root).find((name) => /^client\/main-.*\.js$/.test(name));

    expect(main).toBeDefined();
    expect(entry).toContain(path.basename(/** @type {string} */ (main)));
    expect(read(root, `${PACKAGE}/${main}`)).toMatch(/=\s*2\b/);
  });

  test('a plugin without a <style> block emits no plugin.css and records no styles.own', () => {
    expect(packageFiles(root)).not.toContain('client/plugin.css');
    expect(readJson(root, `${PACKAGE}/pano-plugin.json`).styles?.own).toBeUndefined();
  });

  test('the package keeps the file list it had before the css switch', () => {
    expect(packageFiles(root).filter((name) => name.endsWith('.css'))).toEqual(['client/fallback.css']);
  });

  test('a second build changes nothing', () => {
    const before = [...packageFiles(root)].map((name) => [name, read(root, `${PACKAGE}/${name}`)]);
    const lock = read(root, 'pano-plugin.lock.json');
    const again = cli(root, ['build']);

    expect(again.code).toBe(0);
    expect(read(root, 'pano-plugin.lock.json')).toBe(lock);
    expect(packageFiles(root).map((name) => [name, read(root, `${PACKAGE}/${name}`)])).toEqual(before);
  });
});

describe('controller version stamping', () => {
  const root = makeProject({ 'src/theme/views/GreeterCard.svelte': GREETER_CARD });
  const result = cli(root, ['build']);

  test('the compiled view carries { version: 1 }, the readable copy does not', () => {
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(chunks(root, 'client', 'GreeterCard')).toMatch(/require\("greeter",\s*\{\s*version:\s*1\s*\}\)|require\(`greeter`,\s*\{\s*version:\s*1\s*\}\)|\.require\(['"]greeter['"],\s*\{\s*version:\s*1\s*\}\)/);

    const copy = read(root, `${PACKAGE}/contract/src/views/GreeterCard.svelte`);

    expect(copy).toContain("plugin('min').require('greeter')");
    expect(copy).not.toContain('version');
    expect(copy).toContain('class="min-greeter-card card"');
  });

  test('pano-plugin.json lists the controller version of the view', () => {
    const index = readJson(root, `${PACKAGE}/pano-plugin.json`);

    expect(index.views.GreeterCard.controllers).toEqual({ 'min/greeter': 1 });
    expect(index.views.GreeterCard.roots).toEqual(['div']);
    expect(index.views.HelloPage.controllers).toEqual({});
  });
});

describe('the lock', () => {
  /** A project whose first build wrote a lock. */
  function lockedProject(extra = {}) {
    const root = makeProject(extra);
    const built = cli(root, ['build']);

    expect(built.code, built.stderr).toBe(0);

    return root;
  }

  test('build fails when a controller action is removed without a raised version, naming the fix', () => {
    const root = lockedProject();

    write(root, {
      'src/theme/controllers/greeter.js': `import { defineController } from '@panomc/plugin-kit/controller';

export default defineController({
  name: 'greeter',
  version: 1,
  state: () => ({ greeting: 'Hello' }),
  actions: () => ({}),
});
`,
    });

    const result = cli(root, ['build']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("min/greeter: action 'setGreeting' removed — set version: 2 in src/theme/controllers/greeter.js");
    // the lock still holds the old promise
    expect(readJson(root, 'pano-plugin.lock.json').controllers['min/greeter'].actions).toEqual(['setGreeting']);
  });

  test('raising the version lets the build through and records the new promise', () => {
    const root = lockedProject();

    write(root, {
      'src/theme/controllers/greeter.js': `import { defineController } from '@panomc/plugin-kit/controller';

export default defineController({
  name: 'greeter',
  version: 2,
  state: () => ({ greeting: 'Hello' }),
  actions: () => ({}),
});
`,
    });

    expect(cli(root, ['build']).code).toBe(0);
    expect(readJson(root, 'pano-plugin.lock.json').controllers['min/greeter']).toEqual({
      version: 2,
      state: ['greeting'],
      actions: [],
    });
  });

  test('build fails when a view prop is removed or its root class goes, without a raised contract', () => {
    const root = lockedProject();

    write(root, {
      'src/theme/views/HelloPage.svelte': `<script module>
  export const view = { path: '/hello' };
</script>

<script>
  import { greet } from '../lib/greet.js';
</script>

<h1>{greet('x')}</h1>
`,
    });

    const result = cli(root, ['build']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('min:HelloPage: prop "name" removed — set contract: 2 in HelloPage.svelte');

    write(root, {
      'src/theme/views/HelloPage.svelte': `<script module>
  export const view = { path: '/hello', contract: 2 };
</script>

<script>
  import { greet } from '../lib/greet.js';
</script>

<h1>{greet('x')}</h1>
`,
    });
    expect(cli(root, ['build']).code).toBe(0);
  });

  test('a root class lost to a component-only view is a removed class', () => {
    const root = lockedProject();

    write(root, {
      'src/theme/views/Inner.svelte': '<p>inner</p>\n',
      'src/theme/views/HelloPage.svelte': `<script module>
  export const view = { path: '/hello' };
</script>

<script>
  import Inner from './Inner.svelte';
  let { name = 'Pano' } = $props();
</script>

<Inner {name} />
`,
    });

    const result = cli(root, ['build']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('class min-hello-page removed — set contract: 2 in HelloPage.svelte');
  });

  test('in a watch build the same breaks are warnings and the lock is left alone', async () => {
    const root = lockedProject();
    const lock = read(root, 'pano-plugin.lock.json');

    write(root, {
      'src/theme/controllers/greeter.js': `import { defineController } from '@panomc/plugin-kit/controller';

export default defineController({
  name: 'greeter',
  version: 1,
  state: () => ({ greeting: 'Hello' }),
  actions: () => ({}),
});
`,
    });

    const previous = process.env.PANO_SDK_DIR;

    process.env.PANO_SDK_DIR = sdkDir;

    /** @type {string[]} */
    const warnings = [];
    /** @type {string[]} */
    const errors = [];

    try {
      const configs = await panoPlugin({ root, minify: false });
      const watcher = watch(
        configs.map((config) => ({
          ...config,
          onwarn: (/** @type {any} */ warning) => warnings.push(warning.message),
          watch: { skipWrite: false, chokidar: undefined },
        })),
      );

      await new Promise((resolve, reject) => {
        let ends = 0;
        const timer = setTimeout(() => reject(new Error('watch build timed out')), 60000);

        watcher.on('event', (event) => {
          if (event.code === 'ERROR') errors.push(String(event.error?.message));

          if (event.code === 'BUNDLE_END') {
            event.result?.close();
            ends += 1;
          }

          if (event.code === 'END') {
            clearTimeout(timer);
            resolve(ends);
          }
        });
      });

      await watcher.close();
    } finally {
      if (previous === undefined) delete process.env.PANO_SDK_DIR;
      else process.env.PANO_SDK_DIR = previous;
    }

    expect(errors).toEqual([]);
    expect(warnings.join('\n')).toContain("min/greeter: action 'setGreeting' removed — set version: 2");
    expect(read(root, 'pano-plugin.lock.json')).toBe(lock);
  }, 90000);
});

describe('build rules run in the build', () => {
  test('a view importing a controller fails the build with V1 and the fix', () => {
    const root = makeProject({
      'src/theme/views/HelloPage.svelte': `<script module>
  export const view = { path: '/hello' };
</script>

<script>
  import greeter from '../controllers/greeter.js';
</script>

<h1>{greeter}</h1>
`,
    });
    const result = cli(root, ['build']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('controllers are compiled and closed');
    expect(result.stderr).toContain("plugin('min').require('greeter')");
  });

  test('a controller importing svelte fails the build with V2', () => {
    const root = makeProject({
      'src/theme/controllers/greeter.js': `import { defineController } from '@panomc/plugin-kit/controller';
import { writable } from 'svelte/store';

export default defineController({
  name: 'greeter',
  version: 1,
  state: () => ({ greeting: writable('x') }),
  actions: () => ({}),
});
`,
    });
    const result = cli(root, ['build']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('controllers are framework-free');
  });
});

describe('rollup keeps working on the preset directly', () => {
  test('panoPlugin() returns one config per target and the client build writes into the package folder', async () => {
    const root = makeProject();
    const previous = process.env.PANO_SDK_DIR;

    process.env.PANO_SDK_DIR = sdkDir;

    try {
      const configs = await panoPlugin({ root, minify: false });

      expect(configs.length).toBe(3);

      const bundle = await rollup(configs[0]);
      const { output } = await bundle.generate(/** @type {any} */ (configs[0].output));

      expect(output.some((chunk) => chunk.fileName === 'client.mjs')).toBe(true);
      await bundle.close();
    } finally {
      if (previous === undefined) delete process.env.PANO_SDK_DIR;
      else process.env.PANO_SDK_DIR = previous;
    }
  }, 60000);
});

describe('pano-plugin build on the plugin-style fixture (a view with a <style> block)', () => {
  const root = makeProject({}, styleFixtureDir);
  const run = cli(root, ['build']);

  test('exits 0 and emits client/plugin.css only on the client side', () => {
    expect(run.code, run.stderr).toBe(0);
    expect(run.stderr).not.toContain('Forcing');

    const files = packageFiles(root);

    expect(files).toContain('client/plugin.css');
    expect(files.filter((name) => name.endsWith('plugin.css'))).toEqual(['client/plugin.css']);
  });

  test('plugin.css starts with @layer pano-plugin and holds the component rules', () => {
    const css = read(root, `${PACKAGE}/client/plugin.css`);

    expect(css.startsWith('@layer pano-plugin')).toBe(true);
    expect(css).toContain('.style-styled-card');
    expect(css).toContain('--style-gap');
    expect(css).toContain('StyledCard.svelte');
  });

  test('pano-plugin.json records styles.own and a hash that covers the file', () => {
    const styles = readJson(root, `${PACKAGE}/pano-plugin.json`).styles;

    expect(styles.own).toBe('client/plugin.css');
    expect(styles.hash).toMatch(/^[0-9a-f]{8}$/);
  });

  test('the compiled view carries the css hash class and the bundles hold no css module', () => {
    expect(chunks(root, 'client', 'StyledCard')).toContain('style-styled-card');
    expect(packageFiles(root).filter((name) => name.endsWith('.css')).sort()).toEqual([
      'client/fallback.css',
      'client/plugin.css',
    ]);
  });

  test('a second build changes nothing', () => {
    const before = packageFiles(root).map((name) => [name, read(root, `${PACKAGE}/${name}`)]);
    const again = cli(root, ['build']);

    expect(again.code, again.stderr).toBe(0);
    expect(packageFiles(root).map((name) => [name, read(root, `${PACKAGE}/${name}`)])).toEqual(before);
  });

  test('the committed lock of the fixture is what the build writes', () => {
    expect(JSON.parse(fs.readFileSync(path.join(styleFixtureDir, 'pano-plugin.lock.json'), 'utf8'))).toEqual(
      readJson(root, 'pano-plugin.lock.json'),
    );
  });

  test('check --strict --styles badge passes', () => {
    const check = cli(root, ['check', '--strict', '--styles', 'badge']);

    expect(check.code, check.stdout + check.stderr).toBe(0);
  });

  test('a selector without the namespace class fails with style-block-scope', () => {
    const file = path.join(root, 'src/theme/views/StyledCard.svelte');
    const source = fs.readFileSync(file, 'utf8');

    write(root, { 'src/theme/views/StyledCard.svelte': source.replace('  @keyframes', '  p {\n    color: red;\n  }\n\n  @keyframes') });

    const check = cli(root, ['check', '--strict', '--styles', 'badge']);

    expect(check.code).toBe(1);
    expect(check.stderr + check.stdout).toContain('[style-block-scope]');
    expect(check.stderr + check.stdout).toContain('has no class of the plugin namespace');

    // level core never looks at it
    const core = cli(root, ['check', '--strict']);

    expect(core.stderr + core.stdout).not.toContain('style-block-scope');
  });
});
