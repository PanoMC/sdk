import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  checkId,
  checkPackage,
  checkText,
  classNameOf,
  defaultPackage,
  parseNewArgs,
  runNew,
  targetPath,
  templateValues,
  titleFrom,
} from '../../new.js';
import { capture, cleanup, filesBelow, kitDir, makePluginsDir, themeCore } from './helpers.js';

afterAll(cleanup);

/**
 * Runs `new` with `--no-install --local <this checkout>`.
 *
 * @param {string} cwd
 * @param {string[]} args
 * @param {Record<string, any>} [options]
 */
async function scaffold(cwd, args, options = {}) {
  const io = capture();
  const code = await runNew([...args, '--no-install', '--local', themeCore], { cwd, interactive: false, out: io.out, err: io.err, ...options });

  return { code, stdout: io.stdout(), stderr: io.stderr() };
}

describe('template text: the Gradle files compile and the version gate lets a fresh plugin in', () => {
  const template = path.join(kitDir, 'bin/templates/plugin');
  const gradle = fs.readFileSync(path.join(template, 'build.gradle.kts'), 'utf8');
  const properties = fs.readFileSync(path.join(template, 'gradle.properties'), 'utf8');

  test('java.util classes are imported, never written out (inside a Gradle script `java.` is the java {} extension)', () => {
    const lines = gradle.split('\n').filter((line) => line.includes('java.util.'));

    expect(lines).toEqual(['import java.util.Properties', 'import java.util.zip.ZipFile']);
    expect(gradle).toContain('ZipFile(jar)');
    expect(gradle).toContain('Properties()');
  });

  test('apiLevel=1 is an active line with the comment that says when to delete it', () => {
    expect(properties).toMatch(/^apiLevel=1$/m);
    expect(properties).toContain('Delete this line once the Pano');
  });
});

describe('names derived from the id', () => {
  test('title, class and package', () => {
    expect(titleFrom('my-plugin')).toBe('My Plugin');
    expect(classNameOf('shop')).toBe('Shop');
    expect(classNameOf('my-shop')).toBe('MyShop');
    // the scaffold adds `Plugin` itself, so a trailing "plugin" and the official prefix are dropped
    expect(classNameOf('my-plugin')).toBe('My');
    expect(classNameOf('pano-plugin-market')).toBe('Market');
    expect(classNameOf('plugin')).toBe('Plugin');
    expect(classNameOf('pano-plugin-3d')).toBe('P3d');
    expect(defaultPackage('my-shop')).toBe('com.example.myshop');
  });

  test('every placeholder of the templates has a value (writeScaffold would throw otherwise)', () => {
    const values = templateValues({ id: 'pano-plugin-market', name: 'Market', author: 'Pano', pkg: 'com.panomc.market', local: null, install: false }, '1.2.3');

    expect(values).toMatchObject({
      ID: 'pano-plugin-market',
      NS: 'market',
      CLASS: 'Market',
      PKGPATH: 'com/panomc/market',
      KIT_DEP: '^1.2.3',
      SDK_DEP: '^1.2.3',
      ORG: 'pano',
    });
    expect(targetPath('src/main/kotlin/__PKGPATH__/__CLASS__Plugin.kt', values)).toBe('src/main/kotlin/com/panomc/market/MarketPlugin.kt');
    expect(targetPath('_gitignore', values)).toBe('.gitignore');
    expect(targetPath('package.json.tpl', values)).toBe('package.json');
  });
});

describe('input checks', () => {
  const plugins = makePluginsDir();

  test('ids', () => {
    expect(checkId('my-plugin', plugins)).toBeNull();
    expect(checkId('My-Plugin', plugins)).toContain('kebab-case');
    expect(checkId('1plugin', plugins)).toContain('kebab-case');
    expect(checkId('a--b', plugins)).toContain('kebab-case');
    expect(checkId('trailing-', plugins)).toContain('kebab-case');
    expect(checkId('core', plugins)).toContain('reserved');
    expect(checkId('page', plugins)).toContain('reserved');
  });

  test('an existing folder is refused, even an empty one', () => {
    fs.mkdirSync(path.join(plugins, 'taken'));

    expect(checkId('taken', plugins)).toContain('already exists');
  });

  test('Kotlin packages', () => {
    expect(checkPackage('com.example.shop')).toBeNull();
    expect(checkPackage('shop')).toBeNull();
    expect(checkPackage('Com.Example')).toContain('not a Kotlin package');
    expect(checkPackage('com..example')).toContain('not a Kotlin package');
    expect(checkPackage('com.example.new')).toContain('reserved word');
    expect(checkPackage('com.1example')).toContain('not a Kotlin package');
  });

  test('names and authors that would break a file are refused', () => {
    expect(checkText('Ahmet Düruer', 'the author')).toBeNull();
    for (const bad of ['a"b', 'a\\b', 'a<b', 'a{b', 'a$b', 'a@@b', 'a\nb', '']) {
      expect(checkText(bad, 'the name'), JSON.stringify(bad)).toContain('the name');
    }
  });

  test('argument parsing', () => {
    expect(parseNewArgs(['shop', '--package', 'a.b', '--local', '/x', '--no-install'])).toEqual({
      id: 'shop',
      flags: { package: 'a.b', local: '/x', install: false },
    });
    expect(parseNewArgs(['--local']).flags.local).toBe(true);
    expect(parseNewArgs(['shop', '--local', '--no-install']).flags).toEqual({ local: true, install: false });
    expect(parseNewArgs(['shop', '--package=a.b']).flags.package).toBe('a.b');
    expect(() => parseNewArgs(['a', 'b'])).toThrow('one plugin id');
    expect(() => parseNewArgs(['--nope'])).toThrow('unknown option --nope');
    expect(() => parseNewArgs(['a', '--package'])).toThrow('--package needs a value');
  });
});

describe('the scaffold', () => {
  const plugins = makePluginsDir();
  /** @type {Awaited<ReturnType<typeof scaffold>>} */
  let result;
  const root = path.join(plugins, 'my-shop');
  const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

  test('runs without questions, exits 0 and tells the three steps', async () => {
    result = await scaffold(plugins, ['my-shop']);

    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('scaffolded my-shop/ (21 files, local workspace links)');
    expect(result.stdout).toContain('1. cd my-shop && bun install && bun run dev');
    expect(result.stdout).toContain('2. restart Pano once, then open /my-shop');
    expect(result.stdout).toContain('Steps to first result: 3 (scaffold, dev, restart Pano), 0 files written');
  });

  test('writes exactly the files of doc 02 section 8', () => {
    expect(filesBelow(root)).toEqual([
      '.gitignore',
      'README.md',
      'build.gradle.kts',
      'gradle.properties',
      'gradle/wrapper/gradle-wrapper.jar',
      'gradle/wrapper/gradle-wrapper.properties',
      'gradlew',
      'gradlew.bat',
      'package.json',
      'rollup.config.js',
      'settings.gradle.kts',
      'src/main/kotlin/com/example/myshop/MyShopPlugin.kt',
      'src/main/kotlin/com/example/myshop/frontend/ExampleFallbackPage.kt',
      'src/main/kotlin/com/example/myshop/routes/GetHelloAPI.kt',
      'src/main/kotlin/com/panomc/plugins/license/LicenseGuard.kt',
      'src/main/kotlin/com/panomc/plugins/license/PluginLicenseClient.kt',
      'src/main/resources/config.conf',
      'src/main/resources/frontend-targets.json',
      'src/main/resources/locales/en-US.json',
      'src/main/resources/logo.png',
      'src/theme/views/HelloPage.svelte',
    ]);
  });

  test('no placeholder is left in a text file and no template suffix survives', () => {
    for (const file of filesBelow(root)) {
      if (/\.(jar|png)$/.test(file)) continue;

      expect(read(file), file).not.toMatch(/@@[A-Z_]+@@/);
      expect(file.endsWith('.tpl'), file).toBe(false);
    }
  });

  test('package.json: two devDependencies, file: links, kit scripts', () => {
    const pkg = JSON.parse(read('package.json'));

    expect(pkg.name).toBe('my-shop');
    expect(pkg.devDependencies).toEqual({
      '@panomc/plugin-kit': `file:${path.join(themeCore, 'packages/plugin-kit')}`,
      '@panomc/sdk': `file:${path.join(themeCore, 'packages/sdk')}`,
    });
    expect(pkg.scripts).toEqual({ dev: 'pano-plugin dev', build: 'pano-plugin build', check: 'pano-plugin check' });
  });

  test('rollup.config.js is the two lines of the preset', () => {
    expect(read('rollup.config.js')).toBe("import { panoPlugin } from '@panomc/plugin-kit/rollup';\nexport default panoPlugin();\n");
  });

  test('gradle.properties and Gradle files carry the id, class, api-level helper and copyJar fallback', () => {
    const properties = read('gradle.properties');

    expect(properties).toContain('pluginId=my-shop\n');
    expect(properties).toContain('pluginName=My Shop\n');
    expect(properties).toContain('pluginClass=com.example.myshop.MyShopPlugin\n');
    expect(properties).toContain('pluginDeveloper=CHANGE-ME\n');
    expect(properties).toContain('panoPluginsDir=..\n');

    const gradle = read('build.gradle.kts');

    expect(gradle).toContain('group = "com.example.myshop"');
    expect(gradle).toContain('rootProject.findProperty("panoApiLevel")');
    expect(gradle).toContain('pano-api-level.properties');
    expect(gradle).toContain('attributes["api-level"] = it');
    expect(gradle).toContain('rootProject.extra.has("pluginsDir")');
    expect(gradle).toContain('findProperty("panoPluginsDir")');
    expect(fs.statSync(path.join(root, 'gradlew')).mode & 0o111).not.toBe(0);
  });

  test('Kotlin: plugin class, hello endpoint with a relative path, commented fallback page', () => {
    const plugin = read('src/main/kotlin/com/example/myshop/MyShopPlugin.kt');

    expect(plugin).toContain('package com.example.myshop\n');
    expect(plugin).toContain('class MyShopPlugin : PanoPlugin()');

    const hello = read('src/main/kotlin/com/example/myshop/routes/GetHelloAPI.kt');

    expect(hello).toContain('package com.example.myshop.routes');
    expect(hello).toContain('Path("/hello", RouteType.GET)');
    expect(hello).toContain('"message" to "hi"');
    expect(hello).not.toContain('Path("/api');
    // declared, so the class compiles against the pinned Pano tag (abstract member) and against the new one (open)
    expect(hello).toContain('override fun getValidationHandler(schemaRepository: SchemaRepository): ValidationHandler? = null');
    expect(hello).toContain('import io.vertx.json.schema.SchemaRepository');
    expect(hello).toContain('import io.vertx.ext.web.validation.ValidationHandler');

    const fallback = read('src/main/kotlin/com/example/myshop/frontend/ExampleFallbackPage.kt').split('\n');
    const code = fallback.filter((line) => line.trim() && !line.trim().startsWith('//'));

    // a package line and nothing else: the example is entirely commented out
    expect(code).toEqual(['package com.example.myshop.frontend']);
    expect(fallback.join('\n')).toContain('"my-shop.order"');
    expect(fallback.join('\n')).not.toContain('/*');
  });

  test('resources: empty targets file, one locale, config', () => {
    expect(JSON.parse(read('src/main/resources/frontend-targets.json'))).toEqual({});
    expect(fs.readdirSync(path.join(root, 'src/main/resources/locales'))).toEqual(['en-US.json']);
    expect(JSON.parse(read('src/main/resources/locales/en-US.json'))).toEqual({ 'hello-title': 'Hello from My Shop' });
    expect(read('src/main/resources/config.conf')).toBe('logo-file=logo.png\n');
  });

  test('HelloPage: path /<id>, shows api.get({ path: "/hello" })', () => {
    const page = read('src/theme/views/HelloPage.svelte');

    expect(page).toContain("export const view = { path: '/my-shop' };");
    expect(page).toContain("import { api } from '@panomc/sdk/plugin-api';");
    expect(page).toContain("api.get({ path: '/hello', request: event })");
  });

  test('README carries the quick-start box of QUICKSTART-PLUGIN.md', () => {
    const readme = read('README.md');
    const quickstart = fs.readFileSync(path.join(themeCore, 'docs/QUICKSTART-PLUGIN.md'), 'utf8');
    const box = /```\n(Needs: JDK 17\+[\s\S]*?)```/.exec(quickstart)?.[1];

    expect(box).toBeTruthy();
    expect(readme).toContain(/** @type {string} */ (box));
  });

  test('a second run into the same id is refused and leaves the folder untouched', async () => {
    fs.writeFileSync(path.join(root, 'mine.txt'), 'keep');

    const again = await scaffold(plugins, ['my-shop']);

    expect(again.code).toBe(1);
    expect(again.stderr).toContain('already exists');
    expect(fs.readFileSync(path.join(root, 'mine.txt'), 'utf8')).toBe('keep');
  });
});

describe('options', () => {
  test('--package, --name and --author are honoured and non-ASCII goes into gradle.properties escaped', async () => {
    const plugins = makePluginsDir();
    const result = await scaffold(plugins, ['pano-plugin-market', '--package', 'com.panomc.market', '--name', 'Mağaza', '--author', 'Ahmet Düruer']);
    const root = path.join(plugins, 'pano-plugin-market');

    expect(result.stderr).toBe('');
    expect(fs.existsSync(path.join(root, 'src/main/kotlin/com/panomc/market/MarketPlugin.kt'))).toBe(true);

    const properties = fs.readFileSync(path.join(root, 'gradle.properties'), 'utf8');

    expect(properties).toContain('pluginName=Ma\\u011faza');
    expect(properties).toContain('pluginDeveloper=Ahmet D\\u00fcruer');
    expect(properties).toContain('organization=ahmet-d-ruer');
    expect(fs.readFileSync(path.join(root, 'src/main/resources/locales/en-US.json'), 'utf8')).toContain('Hello from Mağaza');
  });

  test('refusals print the fix and write nothing', async () => {
    const plugins = makePluginsDir();

    for (const [args, message] of /** @type {[string[], string][]} */ ([
      [['Bad_Id'], 'kebab-case'],
      [['core'], 'reserved'],
      [['shop', '--package', 'com.example.class'], 'reserved word'],
      [['shop', '--name', 'a"b'], 'the name'],
    ])) {
      const result = await scaffold(plugins, args);

      expect(result.code, args.join(' ')).toBe(1);
      expect(result.stderr, args.join(' ')).toContain(message);
    }

    expect(fs.readdirSync(plugins)).toEqual([]);
  });

  test('--local must point at a theme-core checkout', async () => {
    const plugins = makePluginsDir();
    const io = capture();
    const code = await runNew(['shop', '--no-install', '--local', plugins], { cwd: plugins, interactive: false, out: io.out, err: io.err });

    expect(code).toBe(1);
    expect(io.stderr()).toContain('is not a theme-core checkout');
    expect(fs.readdirSync(plugins)).toEqual([]);
  });

  test('while the kit is unpublished a plain run links the checkout the kit sits in', async () => {
    const plugins = makePluginsDir();
    const io = capture();
    const code = await runNew(['shop', '--no-install'], { cwd: plugins, interactive: false, out: io.out, err: io.err });

    expect(code).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(plugins, 'shop/package.json'), 'utf8')).devDependencies['@panomc/plugin-kit']).toBe(
      `file:${path.join(themeCore, 'packages/plugin-kit')}`,
    );
  });

  test('outside a folder called plugins it says where the plugin has to live', async () => {
    const plugins = makePluginsDir();
    const elsewhere = path.join(path.dirname(plugins), 'elsewhere');

    fs.mkdirSync(elsewhere);

    const result = await scaffold(elsewhere, ['shop']);

    expect(result.stdout).toContain('Pano finds a plugin\'s dev sources at <pano>/plugins/shop');
    expect((await scaffold(plugins, ['shop'])).stdout).not.toContain('Pano finds');
  });

  test('without an id and without a terminal it asks for one', async () => {
    const plugins = makePluginsDir();
    const io = capture();
    const code = await runNew(['--no-install'], { cwd: plugins, interactive: false, out: io.out, err: io.err });

    expect(code).toBe(1);
    expect(io.stderr()).toContain('a plugin id is required');
  });

  test('new --help prints the usage', async () => {
    const io = capture();

    expect(await runNew(['--help'], { out: io.out, err: io.err })).toBe(0);
    expect(io.stdout()).toContain('Usage: pano-plugin new [<id>]');
  });
});

describe('questions and install', () => {
  /**
   * @param {string[]} answers text answers in the order asked
   * @param {boolean} [install]
   */
  function fakePrompts(answers, install = true) {
    /** @type {string[]} */
    const asked = [];
    const queue = [...answers];

    return {
      asked,
      prompts: {
        text: async ({ message, initial, validate }) => {
          asked.push(message);

          const answer = queue.shift() || initial || '';
          const problem = validate?.(answer);

          if (problem) throw new Error(problem);

          return answer;
        },
        confirm: async ({ message }) => {
          asked.push(message);

          return install;
        },
      },
    };
  }

  test('five questions: id, name, author, Kotlin package, install now', async () => {
    const plugins = makePluginsDir();
    const { asked, prompts } = fakePrompts(['quest-log', '', 'Me', '']);
    const io = capture();
    /** @type {string[]} */
    const installed = [];
    const code = await runNew(['--local', themeCore], {
      cwd: plugins,
      interactive: true,
      prompts,
      install: (dir) => (installed.push(dir), 0),
      out: io.out,
      err: io.err,
    });

    expect(io.stderr()).toBe('');
    expect(code).toBe(0);
    expect(asked).toHaveLength(5);
    expect(asked.map((q) => q.split(' ')[0])).toEqual(['Plugin', 'Display', 'Author?', 'Kotlin', 'Install']);
    expect(installed).toEqual([path.join(plugins, 'quest-log')]);

    const properties = fs.readFileSync(path.join(plugins, 'quest-log/gradle.properties'), 'utf8');

    expect(properties).toContain('pluginName=Quest Log\n');
    expect(properties).toContain('pluginDeveloper=Me\n');
    expect(properties).toContain('pluginClass=com.example.questlog.QuestLogPlugin\n');
    // installed: the next step is just dev
    expect(io.stdout()).toContain('1. cd quest-log && bun run dev');
  });

  test('answering no to "install now" runs nothing; an id given up front skips the id question', async () => {
    const plugins = makePluginsDir();
    const { asked, prompts } = fakePrompts(['quest-log', '', '', ''], false);
    /** @type {string[]} */
    const installed = [];
    const io = capture();

    await runNew(['--local', themeCore], { cwd: plugins, interactive: true, prompts, install: (dir) => (installed.push(dir), 0), out: io.out, err: io.err });

    expect(asked).toHaveLength(5);
    expect(installed).toEqual([]);
    expect(io.stdout()).toContain('1. cd quest-log && bun install && bun run dev');

    // with an id: no questions at all, installs by default
    const second = capture();

    await runNew(['other', '--local', themeCore], { cwd: plugins, interactive: true, prompts, install: (dir) => (installed.push(dir), 0), out: second.out, err: second.err });

    expect(asked).toHaveLength(5);
    expect(installed).toEqual([path.join(plugins, 'other')]);
  });

  test('a failed install keeps the scaffold and says how to finish', async () => {
    const plugins = makePluginsDir();
    const io = capture();
    const code = await runNew(['shop', '--local', themeCore], { cwd: plugins, interactive: false, install: () => 1, out: io.out, err: io.err });

    expect(code).toBe(0);
    expect(fs.existsSync(path.join(plugins, 'shop/package.json'))).toBe(true);
    expect(io.stdout()).toContain('bun install did not complete');
    expect(io.stdout()).toContain('1. cd shop && bun install && bun run dev');
  });
});

describe('bin/ui.js', () => {
  test('exports what the engine copy exports and has no import of the engine', async () => {
    const kit = await import('../../ui.js');
    const engine = await import('../../../../theme-core/bin/ui.js');
    const source = fs.readFileSync(path.join(import.meta.dir, '../../ui.js'), 'utf8');

    expect(Object.keys(kit).sort()).toEqual(Object.keys(engine).sort());
    expect(source).not.toMatch(/from ["']\.\.\/\.\.\/theme-core|@panomc\/theme-core/);
  });
});
