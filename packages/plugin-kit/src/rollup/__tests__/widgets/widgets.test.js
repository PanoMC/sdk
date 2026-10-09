import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { rollup } from 'rollup';
import { RUNTIME_FILES, widgetImportPath } from '@panomc/widget-host/runtime-map';
import { SPECIFIER_MODULES } from '@panomc/widget-host';
import { panoPlugin } from '../../index.js';
import {
  addPartAttributes,
  collectWidgets,
  controllersUsedBy,
  defaultTagOf,
  hasWidgetViews,
  readLoad,
  sessionControllers,
} from '../../widgets.js';
import { resolveProject } from '../../rules.js';
import {
  buildError,
  buildWidgets,
  cleanup,
  copyFixture,
  filesOf,
  fixture,
  pluginMin,
  read,
  sdkDir,
  sides,
  tempDir,
  write,
} from './helpers.js';

/** @type {string | undefined} */
let previousSdkDir;

beforeAll(() => {
  previousSdkDir = process.env.PANO_SDK_DIR;
  process.env.PANO_SDK_DIR = sdkDir;
});

afterAll(() => {
  if (previousSdkDir === undefined) delete process.env.PANO_SDK_DIR;
  else process.env.PANO_SDK_DIR = previousSdkDir;

  cleanup();
});

const installedSvelte = JSON.parse(fs.readFileSync(path.join(sdkDir, 'node_modules/svelte/package.json'), 'utf8')).version;

describe('the widgets build of the fixture plugin', () => {
  /** @type {Awaited<ReturnType<typeof buildWidgets>>} */
  let built;
  /** @type {Record<string, any>} */
  let index;

  beforeAll(async () => {
    built = await buildWidgets(fixture);
    index = JSON.parse(built.files['widgets.json']);
  });

  test('two widget views build: one module each, one shared chunk, widgets.json', () => {
    const names = Object.keys(built.files).sort();

    expect(names.filter((name) => /^GoalWidget-[\w-]+\.js$/.test(name))).toHaveLength(1);
    expect(names.filter((name) => /^StatsWidget-[\w-]+\.js$/.test(name))).toHaveLength(1);
    expect(names.filter((name) => /^chunk-[\w-]+\.js$/.test(name))).toHaveLength(1);
    expect(names).toContain('widgets.json');
    expect(names).toHaveLength(4);
  });

  test('widgets.json: format 1, the svelte pin, one record per widget', () => {
    expect(index.format).toBe(1);
    expect(index.svelte).toBe(installedSvelte);
    expect(index.widgets.map((widget) => widget.view)).toEqual(['GoalWidget', 'StatsWidget']);

    const [goal, stats] = index.widgets;

    expect(goal).toEqual({
      view: 'GoalWidget',
      tag: 'goal',
      module: Object.keys(built.files).find((name) => name.startsWith('GoalWidget-')),
      attrs: [{ name: 'title', attribute: 'title', type: 'string' }],
      session: 'none',
    });
    expect(stats.tag).toBe('numbers');
    expect(stats.module).toMatch(/^StatsWidget-[\w-]+\.js$/);
    // primitive props only, kebab-cased attribute names; the object prop `stats` comes from load()
    expect(stats.attrs).toEqual([
      { name: 'limit', attribute: 'limit', type: 'number' },
      { name: 'compact', attribute: 'compact', type: 'boolean' },
      { name: 'goalId', attribute: 'goal-id', type: 'number' },
    ]);
  });

  test('session is inferred from the controllers of the view (host.session -> optional)', () => {
    expect(index.widgets[0].session).toBe('none');
    expect(index.widgets[1].session).toBe('optional');
  });

  test('a module exports { component, load, attrs, session }', async () => {
    const config = (await sides(fixture, tempDir(), ['widgets']))[0];
    const bundle = await rollup(config);
    const { output } = await bundle.generate(/** @type {any} */ (config.output));

    await bundle.close();

    const entries = output.filter((chunk) => chunk.type === 'chunk' && chunk.isEntry);

    expect(entries).toHaveLength(2);

    for (const entry of entries) expect([...entry.exports].sort()).toEqual(['attrs', 'component', 'load', 'session']);
  });

  test('host specifiers become the relative runtime URLs of doc 06 section 3.3', () => {
    const goal = built.files[Object.keys(built.files).find((name) => name.startsWith('GoalWidget-'))];
    const prefix = '../../../../../widgets/runtime/';

    expect(widgetImportPath('@panomc/sdk/toasts')).toBe(`${prefix}host/toasts.js`);
    expect(goal).toContain(`'${prefix}svelte/internal-client.js'`);
    expect(goal).toContain(`'${prefix}host/toasts.js'`);
    expect(goal).toContain(`'${prefix}host/utils-language.js'`);
    expect(built.files[Object.keys(built.files).find((name) => name.startsWith('StatsWidget-'))]).toContain(
      `'${prefix}host/controllers.js'`,
    );

    for (const [name, code] of Object.entries(built.files)) {
      if (!name.endsWith('.js')) continue;

      for (const match of code.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)) {
        expect(match[1].startsWith('.')).toBe(true); // nothing bare is left: no import map needed
      }
    }
  });

  test('the part step copies semantic classes to part attributes in the widget bundle', () => {
    const goal = built.files[Object.keys(built.files).find((name) => name.startsWith('GoalWidget-'))];

    expect(goal).toMatch(/part="[^"]*goals-goal-widget__bar[^"]*"/);
    expect(goal).toMatch(/part="[^"]*goals-goal-widget__title[^"]*"/);
    // the root class of the view is a part too
    expect(goal).toMatch(/part="[^"]*goals-goal-widget goals-goal-widget__card|part="goals-goal-widget /);
  });

  test('a minified build keeps the relative runtime URLs and the exports', async () => {
    const minified = await buildWidgets(fixture, { minify: true });
    const goal = minified.files[Object.keys(minified.files).find((name) => name.startsWith('GoalWidget-'))];

    expect(goal).toContain('../../../../../widgets/runtime/host/toasts.js');
    expect(goal).toMatch(/export\s*\{[^}]*\bcomponent\b/);
    expect(JSON.parse(minified.files['widgets.json']).widgets).toHaveLength(2);
  });

  test('widgets.json and the modules are deterministic', async () => {
    const again = await buildWidgets(fixture);

    expect(again.files).toEqual(built.files);
  });
});

describe('the target exists only when a view has widget', () => {
  test('no widget view: no widgets/ directory, nothing written', async () => {
    const { out, files } = await buildWidgets(pluginMin);

    expect(files).toEqual({});
    expect(fs.existsSync(path.join(out, 'widgets'))).toBe(false);
    expect(fs.readdirSync(out)).toEqual([]);
  });

  test('no widget view: a stale widgets/ directory is removed', async () => {
    const out = tempDir();

    fs.mkdirSync(path.join(out, 'widgets'));
    fs.writeFileSync(path.join(out, 'widgets/old.js'), '//');

    await write(await sides(pluginMin, out, ['widgets']));

    expect(fs.existsSync(path.join(out, 'widgets'))).toBe(false);
  });

  test('hasWidgetViews tells the preset whether to build it', async () => {
    expect(await hasWidgetViews({ pluginId: 'pano-plugin-goals', root: fixture })).toBe(true);
    expect(await hasWidgetViews({ pluginId: 'pano-plugin-min', root: pluginMin })).toBe(false);
  });

  test('the client bundle is byte-identical with or without the widgets target', async () => {
    for (const root of [fixture, pluginMin]) {
      const alone = tempDir();
      const together = tempDir();

      await write(await sides(root, alone, ['server', 'client']));
      await write(await sides(root, together, ['server', 'client', 'widgets']));

      const before = filesOf(path.join(alone, 'client'));
      const after = filesOf(path.join(together, 'client'));

      expect(Object.keys(before).length).toBeGreaterThan(0);
      expect(after).toEqual(before);
      expect(filesOf(path.join(together, 'server'))).toEqual(filesOf(path.join(alone, 'server')));
    }
  });

  test('the client bundle never carries part attributes', async () => {
    const out = tempDir();

    await write(await sides(fixture, out, ['client']));

    for (const code of Object.values(filesOf(path.join(out, 'client')))) expect(code).not.toMatch(/part="/);
  });

  test('badges.widgets is true after the widgets build, false without widgets', async () => {
    const withWidgets = tempDir();

    await write(await sides(fixture, withWidgets, ['server', 'client', 'widgets']));
    expect(JSON.parse(read(withWidgets, 'pano-plugin.json')).badges.widgets).toBe(true);

    const withoutWidgets = tempDir();

    await write(await sides(pluginMin, withoutWidgets, ['server', 'client', 'widgets']));
    expect(JSON.parse(read(withoutWidgets, 'pano-plugin.json')).badges.widgets).toBe(false);
  });

  test('badges.widgets is true when the client build runs after the widgets build', async () => {
    const out = tempDir();

    await write(await sides(fixture, out, ['widgets', 'server', 'client']));
    expect(JSON.parse(read(out, 'pano-plugin.json')).badges.widgets).toBe(true);
  });

  test('a view that has no widget key is not built even next to widget views', async () => {
    const { files } = await buildWidgets(fixture);

    expect(Object.keys(files).some((name) => name.startsWith('GoalsPage'))).toBe(false);
  });
});

describe('build errors', () => {
  test('an import with no widget implementation names the file, the import and the view', async () => {
    const root = copyFixture({
      'src/theme/views/GoalWidget.svelte': read(fixture, 'src/theme/views/GoalWidget.svelte').replace(
        "import { percent }",
        "import { Thing } from '@panomc/sdk/not-there';\n  import { percent }",
      ),
    });

    expect(await buildError(root)).toContain(
      'src/theme/views/GoalWidget.svelte imports @panomc/sdk/not-there, which has no widget implementation. Remove GoalWidget from widgets or avoid the import.',
    );
  });

  test('an unsupported import in a shared helper names every widget view that reaches it', async () => {
    const root = copyFixture({
      'src/theme/lib/percent.js': `import { x } from 'svelte/compiler';\n${read(fixture, 'src/theme/lib/percent.js')}`,
    });
    const message = await buildError(root);

    expect(message).toContain('src/theme/lib/percent.js imports svelte/compiler, which has no widget implementation.');
    expect(message).toContain('Remove GoalWidget, StatsWidget from widgets or avoid the import.');
  });

  test('a required object prop that load() does not return', async () => {
    const goal = read(fixture, 'src/theme/views/GoalWidget.svelte');
    const withoutLoad = copyFixture({
      'src/theme/views/GoalWidget.svelte': goal.replace(/\n  export const load =.*\n/, '\n'),
    });

    expect(await buildError(withoutLoad)).toContain(
      'GoalWidget needs prop "data": return it from load() or remove widget from its view metadata',
    );

    const wrongKey = copyFixture({
      'src/theme/views/GoalWidget.svelte': goal.replace('({ data })', '({ other: data })'),
    });

    expect(await buildError(wrongKey)).toContain('GoalWidget needs prop "data"');
  });

  test('a load() the build cannot read is trusted', async () => {
    const goal = read(fixture, 'src/theme/views/GoalWidget.svelte');
    const root = copyFixture({
      'src/theme/views/GoalWidget.svelte': goal.replace(/export const load =.*\n/, 'export const load = (event) => fetchSomething(event);\n'),
    });
    const { files } = await buildWidgets(root);

    expect(Object.keys(files).some((name) => name.startsWith('GoalWidget-'))).toBe(true);
  });

  test('two views that make one tag name both', async () => {
    const root = copyFixture({
      'src/theme/views/GoalBlock.svelte': `<script module>\n  export const view = { widget: true };\n</script>\n\n<p>block</p>\n`,
    });
    const message = await buildError(root);

    expect(message).toContain('GoalBlock and GoalWidget both make the tag <pano-goals-goal>');
    expect(message).toContain('src/theme/views/GoalWidget.svelte');
  });

  test('widget metadata that cannot be read', async () => {
    const root = copyFixture({
      'src/theme/views/StatsWidget.svelte': read(fixture, 'src/theme/views/StatsWidget.svelte').replace(
        "{ widget: { tag: 'numbers' } }",
        "{ widget: { tag: 'Bad Tag' } }",
      ),
    });

    expect(await buildError(root)).toContain('view.widget.tag must be lowercase words joined by "-"');
  });
});

describe('session', () => {
  test('the author can set it', async () => {
    const root = copyFixture({
      'src/theme/views/GoalWidget.svelte': read(fixture, 'src/theme/views/GoalWidget.svelte').replace(
        'widget: true',
        "widget: { session: 'required' }",
      ),
    });
    const { files } = await buildWidgets(root);
    const index = JSON.parse(files['widgets.json']);

    expect(index.widgets.find((widget) => widget.view === 'GoalWidget')).toMatchObject({ tag: 'goal', session: 'required' });
  });

  test('a controller that calls host.session, directly or through a sibling', async () => {
    const project = await resolveProject({ root: fixture });

    expect([...sessionControllers(project)]).toEqual(['stats']);

    const root = copyFixture({
      'src/theme/controllers/wrapper.js': `import { defineController } from '@panomc/plugin-kit/controller';\nexport default defineController({ name: 'wrapper', version: 1, state: () => ({}), actions: ({ use }) => ({ go() { use('stats').actions.refresh(); } }) });\n`,
    });

    expect([...sessionControllers(await resolveProject({ root }))].sort()).toEqual(['stats', 'wrapper']);
  });

  test('controllersUsedBy reads literal names in the view and its relative imports', () => {
    const stats = path.join(fixture, 'src/theme/views/StatsWidget.svelte');

    expect([...controllersUsedBy(stats, 'goals', fixture)]).toEqual(['stats']);
  });
});

describe('parts', () => {
  test('the root class and every semantic class become part names', () => {
    const { code, parts } = addPartAttributes(
      '<div class="card min-box__body">\n  <p class="min-box__text is-open">x</p>\n  <span class="plain">y</span>\n</div>\n',
      { ns: 'min', view: 'Box' },
    );

    expect(parts).toBe(2);
    expect(code).toContain('<div part="min-box min-box__body" class="min-box card min-box__body">');
    expect(code).toContain('<p part="min-box__text" class="min-box__text is-open">');
    expect(code).not.toContain('<span part');
  });

  test('literal classes of expressions and class: directives count, an existing part stays', () => {
    const { code } = addPartAttributes(
      '<div class={[\'min-box__a\', cond && \'min-box__b\']} class:min-box__c={on}>x</div>\n<i part="mine" class="min-box__d"></i>\n',
      { ns: 'min', view: 'Box' },
    );

    expect(code).toContain('part="min-box min-box__a min-box__b min-box__c"');
    expect(code).toContain('<i part="mine"');
    expect(code.match(/part=/g)).toHaveLength(2);
  });

  test('the step is idempotent and leaves a source without elements alone', () => {
    const once = addPartAttributes('<div class="min-box__a">x</div>', { ns: 'min', view: 'Box' }).code;

    expect(addPartAttributes(once, { ns: 'min', view: 'Box' }).code).toBe(once);
    expect(addPartAttributes('<script>let a = 1;</script>', { ns: 'min', view: 'Box' })).toEqual({
      code: '<script>let a = 1;</script>',
      parts: 0,
    });
  });
});

describe('reading a view', () => {
  test('readLoad: the keys a load() returns', () => {
    const shape = (script) => readLoad(`<script module>\n${script}\n</script>\n`);

    expect(shape('export const load = () => ({ a: 1, b })').shape).toEqual({ keys: new Set(['a', 'b']), open: false });
    expect(shape('export async function load() { if (x) return { a }; return { b }; }').shape.keys).toEqual(new Set(['a', 'b']));
    expect(shape('export const load = () => fetch(x).then((r) => ({ r }))').shape).toEqual({ keys: new Set(['r']), open: false });
    expect(shape('export const load = () => ({ ...base, a })').shape.open).toBe(true);
    expect(shape('function go() { return { z: 1 }; }\nexport { go as load };').shape.keys).toEqual(new Set(['z']));
    expect(shape('export const view = {};').hasLoad).toBe(false);
  });

  test('defaultTagOf strips Widget / Block', () => {
    expect(defaultTagOf('GoalWidget')).toBe('goal');
    expect(defaultTagOf('RecentBuyersWidget')).toBe('recent-buyers');
    expect(defaultTagOf('NavCart')).toBe('nav-cart');
    expect(defaultTagOf('TopBlock')).toBe('top');
    expect(defaultTagOf('Widget')).toBe('widget');
  });

  test('collectWidgets reports the tag as the element name', async () => {
    const { scanViews } = await import('../../views.js');
    const scan = await scanViews({ dirs: ['src/theme/views'], namespace: 'goals', pluginId: 'pano-plugin-goals', root: fixture });

    expect(collectWidgets({ scan, namespace: 'goals' }).map((widget) => widget.element)).toEqual([
      'pano-goals-goal',
      'pano-goals-numbers',
    ]);
  });
});

describe('the runtime table', () => {
  test('every SDK facade of the widget host has a runtime file, and the preset aliases exactly those', () => {
    for (const specifier of Object.keys(SPECIFIER_MODULES)) expect(RUNTIME_FILES[specifier]).toBeTruthy();

    expect(Object.keys(RUNTIME_FILES).filter((specifier) => specifier.startsWith('@panomc/sdk')).sort()).toEqual(
      Object.keys(SPECIFIER_MODULES).sort(),
    );
  });

  test('panoPlugin() hands the widgets side to panoWidgets', async () => {
    const [config] = await panoPlugin({ root: fixture, outDir: tempDir(), side: 'widgets' });

    expect(config.plugins.some((plugin) => plugin?.name === 'pano-widgets')).toBe(true);
  });
});
