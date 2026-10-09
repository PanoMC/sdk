import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PACKAGE, bin, capture, cleanup, filesBelow, makePluginsDir, sdkDir, themeCore } from './helpers.js';

afterAll(cleanup);

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function cli(cwd, args) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, PANO_SDK_DIR: sdkDir },
    timeout: 120000,
  });

  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

describe('pano-plugin new, then check and the UI build, with no edit in between', () => {
  const plugins = makePluginsDir();
  const root = path.join(plugins, 'my-plugin');
  const scaffolded = cli(plugins, ['new', 'my-plugin', '--local', themeCore, '--no-install']);

  test('the CLI scaffolds the folder (and the help lists the command)', () => {
    expect(scaffolded.stderr).toBe('');
    expect(scaffolded.code).toBe(0);
    expect(fs.existsSync(path.join(root, 'src/theme/views/HelloPage.svelte'))).toBe(true);
    expect(cli(plugins, ['--help']).stdout).toContain('new [<id>]');
  });

  // a real install is not run here: the workspace node_modules stands in for it, like the other kit tests
  fs.symlinkSync(path.join(themeCore, 'node_modules'), path.join(root, 'node_modules'));

  const before = fs.existsSync(root) ? filesBelow(root).filter((name) => !name.startsWith('node_modules/')) : [];
  const checked = cli(root, ['check']);
  const built = cli(root, ['build']);

  test('pano-plugin check passes on the untouched scaffold', () => {
    expect(checked.stderr).toBe('');
    expect(checked.code).toBe(0);
    expect(checked.stdout).toContain('check passed (0 warnings)');
    expect(checked.stdout).toContain('public (readable): 1 view, 0 helpers · closed: 0 controllers');
  });

  test('the UI build writes the package: one page /my-plugin, contract 1', () => {
    expect(built.stderr).toBe('');
    expect(built.code).toBe(0);

    const views = JSON.parse(fs.readFileSync(path.join(root, PACKAGE, 'contract/views.json'), 'utf8'));

    expect(views.pluginId).toBe('my-plugin');
    expect(Object.keys(views.views)).toEqual(['my-plugin:HelloPage']);
    expect(views.views['my-plugin:HelloPage']).toMatchObject({ kind: 'page', contract: 1, page: { path: '/my-plugin' } });

    for (const side of ['client', 'server']) {
      const bundle = filesBelow(path.join(root, PACKAGE, side))
        .filter((name) => name.endsWith('.js') || name.endsWith('.mjs'))
        .map((name) => fs.readFileSync(path.join(root, PACKAGE, side, name), 'utf8'))
        .join('\n');

      // the page calls the plugin's own API through the virtual @panomc/sdk/plugin-api module
      expect(bundle, side).toContain('createPluginApi');
      expect(bundle, side).toContain('"my-plugin"');
      expect(bundle, side).toContain('/hello');
    }
  });

  test('the build wrote only build output and the lock: no source file of the scaffold changed', () => {
    const after = filesBelow(root).filter((name) => !name.startsWith('node_modules/') && !name.startsWith(PACKAGE));

    // pano-plugin.lock.json is the view / controller promise the build records; the author commits it
    expect(after).toEqual([...before, 'pano-plugin.lock.json'].sort());
    expect(fs.readFileSync(path.join(root, 'src/main/resources/frontend-targets.json'), 'utf8')).toBe('{}\n');
  });

  test('step count', () => {
    const next = scaffolded.stdout.split('\n').filter((line) => /^\s+\d+\.\s/.test(line));
    // the command itself is step 1; the printed list holds the steps after it, the install is part of the scaffold
    const steps = 1 + next.length;
    const written = 0; // check and build passed above without a single edit after the scaffold

    console.log(`pano-plugin new: steps to first result = ${steps} (scaffold, dev, restart Pano), files written by hand = ${written}`);

    expect(steps).toBe(3);
    expect(scaffolded.stdout).toContain(`Steps to first result: ${steps} (scaffold, dev, restart Pano), ${written} files written`);
  });
});

describe('scaffold errors through the CLI', () => {
  test('an existing folder is refused with exit code 1', () => {
    const plugins = makePluginsDir();

    fs.mkdirSync(path.join(plugins, 'taken'));

    const result = cli(plugins, ['new', 'taken', '--no-install']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('pano-plugin new: ');
    expect(result.stderr).toContain('already exists');
    expect(fs.readdirSync(path.join(plugins, 'taken'))).toEqual([]);
  });

  test('capture helper stays quiet when nothing ran', () => {
    expect(capture().stdout()).toBe('');
  });
});
