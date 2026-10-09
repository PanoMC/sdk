import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { GREETER_CARD, PACKAGE, bin, cleanup, cli, fixtureDir, makeProject, read, readJson, write } from './helpers.js';

afterAll(cleanup);

const COUNT_LINE = /^public \(readable\): \d+ views?, \d+ helpers? · closed: \d+ controllers?$/;

/** @param {string} stdout */
const lastLine = (stdout) => stdout.trimEnd().split('\n').at(-1);

describe('pano-plugin dispatcher', () => {
  const root = makeProject();

  test('no command prints the help and exits 1; --help exits 0', () => {
    expect(cli(root, []).code).toBe(1);
    expect(cli(root, []).stdout).toContain('Usage: pano-plugin <command>');

    const help = cli(root, ['--help']);

    expect(help.code).toBe(0);
    for (const command of ['dev', 'build', 'check', 'classes']) expect(help.stdout).toContain(command);
  });

  test('publish-controllers says it is not available yet', () => {
    for (const command of ['publish-controllers']) {
      const result = cli(root, [command]);

      expect(result.code, command).toBe(1);
      expect(result.stderr, command).toContain(`pano-plugin ${command}: not available yet`);
    }
  });

  test('an unknown command or option is refused with the help', () => {
    expect(cli(root, ['frobnicate']).stderr).toContain('unknown command "frobnicate"');
    expect(cli(root, ['check', '--nope']).stderr).toContain('unknown option --nope');
    expect(cli(root, ['check', '--styles', 'loud']).code).toBe(1);
  });

  test('the bin script has a node shebang and is executable', () => {
    expect(fs.readFileSync(bin, 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true);
    expect(fs.statSync(bin).mode & 0o111).not.toBe(0);
  });
});

describe('pano-plugin check', () => {
  test('the fixture passes and the output ends with the public / closed count line', () => {
    const result = cli(fixtureDir, ['check']);

    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('check passed');
    expect(lastLine(result.stdout)).toMatch(COUNT_LINE);
    expect(lastLine(result.stdout)).toBe('public (readable): 1 view, 1 helper · closed: 1 controller');
  });

  test('check runs without PANO_SDK_DIR and writes nothing into the plugin', () => {
    const root = makeProject();
    const before = fs.readdirSync(root).sort();
    const result = cli(root, ['check'], { PANO_SDK_DIR: '' });

    expect(result.code, result.stderr).toBe(0);
    expect(fs.readdirSync(root).sort()).toEqual(before);
    expect(fs.existsSync(path.join(root, PACKAGE))).toBe(false);
  });

  test('V1: a view importing a controller fails and names the fix', () => {
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
    const result = cli(root, ['check']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('controllers are compiled and closed');
    expect(lastLine(result.stdout)).toMatch(COUNT_LINE);
  });

  test('V1: a view helper importing a package fails', () => {
    const root = makeProject({
      'src/theme/lib/greet.js': "import dayjs from 'dayjs';\n\nexport const greet = (name) => dayjs(name).format();\n",
    });
    const result = cli(root, ['check']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('view helpers ship as readable source and cannot import packages');
  });

  test('V2: a controller importing svelte fails', () => {
    const root = makeProject({
      'src/theme/controllers/greeter.js': `import { defineController } from '@panomc/plugin-kit/controller';
import { writable } from 'svelte/store';

export default defineController({ name: 'greeter', version: 1, state: () => ({ greeting: writable('x') }), actions: () => ({}) });
`,
    });
    const result = cli(root, ['check']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('controllers are framework-free');
  });

  test('V5: getContext in a view fails; PANO_VIEW_IMPORTS=warn turns it into a warning', () => {
    const root = makeProject({
      'src/theme/views/HelloPage.svelte': `<script module>
  export const view = { path: '/hello' };
</script>

<script>
  import { getContext } from 'svelte';

  const ctx = getContext('x');
</script>

<h1>{ctx}</h1>
`,
    });

    expect(cli(root, ['check']).code).toBe(1);

    const migration = cli(root, ['check'], { PANO_VIEW_IMPORTS: 'warn' });

    expect(migration.code).toBe(0);
    expect(migration.stderr).toContain('warning:');
    expect(migration.stderr).toContain('PANO_VIEW_IMPORTS=warn');
    expect(cli(root, ['check', '--strict'], { PANO_VIEW_IMPORTS: 'warn' }).code).toBe(1);
  });

  test('lock: a removed action and a removed prop fail the check against the committed lock', () => {
    const root = makeProject({
      'pano-plugin.lock.json': fs.readFileSync(path.join(fixtureDir, 'pano-plugin.lock.json'), 'utf8'),
    });

    expect(cli(root, ['check']).code).toBe(0);

    write(root, {
      'src/theme/controllers/greeter.js': `import { defineController } from '@panomc/plugin-kit/controller';

export default defineController({ name: 'greeter', version: 1, state: () => ({ greeting: 'Hello' }), actions: () => ({}) });
`,
      'src/theme/views/HelloPage.svelte': `<script module>
  export const view = { path: '/hello' };
</script>

<h1>Hi</h1>
`,
    });

    const result = cli(root, ['check']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("min/greeter: action 'setGreeting' removed — set version: 2 in src/theme/controllers/greeter.js");
    expect(result.stderr).toContain('min:HelloPage: prop "name" removed — set contract: 2 in HelloPage.svelte');
    // the lock is only ever written by build
    expect(JSON.parse(read(root, 'pano-plugin.lock.json')).controllers['min/greeter'].actions).toEqual(['setGreeting']);
  });

  test('style lint: a foreign class is a warning at core level, a failure with --strict and --styles badge', () => {
    const root = makeProject({
      'src/theme/views/HelloPage.svelte': `<script module>
  export const view = { path: '/hello' };
</script>

<h1 class="shout">Hi</h1>
`,
    });
    const core = cli(root, ['check']);

    expect(core.code, core.stderr).toBe(0);
    expect(core.stderr).toContain('warning:');
    expect(core.stderr).toContain('class-allowed');
    expect(cli(root, ['check', '--strict']).code).toBe(1);

    const badge = cli(root, ['check', '--styles', 'badge']);

    expect(badge.code).toBe(1);
    expect(badge.stderr).toContain('error:');
  });

  test('the Svelte pin: a package.json that declares svelte is reported', () => {
    const root = makeProject({
      'package.json': JSON.stringify({ name: 'x', type: 'module', devDependencies: { svelte: '5.0.0' } }),
    });
    const result = cli(root, ['check']);

    expect(result.stderr).toContain('declares svelte 5.0.0');
  });

  test('an old hand-copied rollup.config.js is reported', () => {
    const root = makeProject({ 'rollup.config.js': "export default [{ input: 'src/main.js' }];\n" });
    const result = cli(root, ['check']);

    expect(result.stderr).toContain('old hand-copied config');
    expect(result.stderr).toContain("import { panoPlugin } from '@panomc/plugin-kit/rollup'");
    expect(cli(root, ['check', '--strict']).code).toBe(1);
  });

  test('API paths: a call to a path that is not a route fails the check', () => {
    const root = makeProject({
      'src/theme/lib/load.js':
        "import ApiUtil from '@panomc/sdk/utils/api';\n\nexport const load = () => ApiUtil.get({ path: '/definitely-not-a-route' });\n",
    });
    const result = cli(root, ['check']);

    expect(result.code, result.stderr).toBe(1);
    expect(result.stderr).toContain('/definitely-not-a-route');
    expect(result.stderr).toContain('is not a Pano route');
  });
});

describe('pano-plugin classes', () => {
  const view = `<script module>
  export const view = { path: '/hello' };
</script>

<div class="card">
  <div class="card-body">
    <h5 class="card-title">Hi</h5>
  </div>
</div>
`;

  test('without --fix it lists the names and writes nothing', () => {
    const root = makeProject({ 'src/theme/views/HelloPage.svelte': view });
    const result = cli(root, ['classes']);

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('+ min-hello-page');
    expect(result.stdout).toContain('+ min-hello-page__body');
    expect(result.stdout).toContain('+ min-hello-page__title');
    expect(result.stdout).toContain('run pano-plugin classes --fix');
    expect(read(root, 'src/theme/views/HelloPage.svelte')).toBe(view);
  });

  test('--fix writes the root and part classes, a second run has nothing to add, and the badge lint passes', () => {
    const root = makeProject({ 'src/theme/views/HelloPage.svelte': view });
    const fixed = cli(root, ['classes', '--fix']);

    expect(fixed.code, fixed.stderr).toBe(0);
    expect(fixed.stdout).toContain('written');

    const source = read(root, 'src/theme/views/HelloPage.svelte');

    expect(source).toContain('class="min-hello-page card"');
    expect(source).toContain('min-hello-page__body');
    expect(source).toContain('min-hello-page__title');
    expect(cli(root, ['classes']).stdout).toContain('nothing to add');
    expect(cli(root, ['check', '--styles', 'badge']).code).toBe(0);

    // and the build now holds the badge and locks the part classes
    expect(cli(root, ['build']).code).toBe(0);
    expect(readJson(root, `${PACKAGE}/pano-plugin.json`).badges.semanticClasses).toBe(true);
    expect(readJson(root, `${PACKAGE}/pano-plugin.json`).views.HelloPage.classes).toEqual([
      'min-hello-page',
      'min-hello-page__body',
      'min-hello-page__title',
    ]);
    expect(readJson(root, 'pano-plugin.lock.json').views['min:HelloPage'].classes).toEqual([
      'min-hello-page',
      'min-hello-page__body',
      'min-hello-page__title',
    ]);
  });

  test('with the badge held, dropping a part class fails the build with the contract fix', () => {
    const root = makeProject({ 'src/theme/views/HelloPage.svelte': view });

    expect(cli(root, ['classes', '--fix']).code).toBe(0);
    expect(cli(root, ['build']).code).toBe(0);

    write(root, {
      'src/theme/views/HelloPage.svelte': read(root, 'src/theme/views/HelloPage.svelte').replace(
        /min-hello-page__title /,
        '',
      ),
    });

    const result = cli(root, ['build']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('class min-hello-page__title removed — set contract: 2 in HelloPage.svelte');
  });

  test('a view with a second page of its own keeps controllers in the index (stamp usage reaches the badge build)', () => {
    const root = makeProject({ 'src/theme/views/GreeterCard.svelte': GREETER_CARD });

    expect(cli(root, ['classes', '--fix']).code).toBe(0);
    expect(cli(root, ['build']).code).toBe(0);
    expect(readJson(root, `${PACKAGE}/pano-plugin.json`).views.GreeterCard.controllers).toEqual({ 'min/greeter': 1 });
  });
});
