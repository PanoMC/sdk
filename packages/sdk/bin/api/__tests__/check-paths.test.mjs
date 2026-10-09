import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { checkPaths, collectCalls, fits, suggest } from '../check-paths.mjs';
import { walk } from '../util.mjs';
import { FIXTURES, cleanup, copyFixture, runCli, tempDir } from './helpers.mjs';

afterAll(cleanup);

/** A routes.core.json written the way extract-routes --core writes it. */
function routesFile(paths) {
  const f = path.join(tempDir(), 'routes.core.json');
  fs.writeFileSync(f, JSON.stringify(paths.map((p) => ({ method: 'GET', path: `/api/v1${p}` }))));
  return f;
}
const CORE = ['/site-info', '/posts', '/posts/:url', '/panel/addons', '/panel/addons/:pluginId', '/panel/basicData', '/ticket-categories'];

describe('check-paths', () => {
  test('the migrated fixture passes (core routes, plugin routes through the plugin client)', () => {
    const r = checkPaths({ root: path.join(FIXTURES, 'plugin-new'), routes: routesFile(CORE) });
    expect(r.errors).toEqual([]);
    expect(r.problems).toEqual([]);
    expect(r.checked).toBe(6);
  });

  test('reports file:line, the literal and a suggestion', () => {
    const dir = copyFixture('plugin-new');
    fs.writeFileSync(
      path.join(dir, 'src/panel/Bad.js'),
      [
        "import ApiUtil from '@panomc/sdk/utils/api';",
        "ApiUtil.get({ path: '/panel/addon' });",
        'ApiUtil.get({ path: `/posts/${url}` });',
        "ApiUtil.get({ path: '/api/posts' });",
        "ApiUtil.get({ path: '/completely/different/route/here' });",
        'const dynamic = ApiUtil.get({ path: prefix + "/x" });',
      ].join('\n'),
    );
    const r = checkPaths({ root: dir, routes: routesFile(CORE) });
    expect(r.problems).toEqual([
      "src/panel/Bad.js:2 '/panel/addon' is not a Pano route (did you mean '/panel/addons'?)",
      "src/panel/Bad.js:4 '/api/posts' must not start with /api: write '/posts'",
      "src/panel/Bad.js:5 '/completely/different/route/here' is not a Pano route",
    ]);
  });

  test('plugin client paths are matched against the repository\'s own declared routes', () => {
    const dir = copyFixture('plugin-new');
    fs.writeFileSync(
      path.join(dir, 'src/theme/Plugin.js'),
      [
        "import { api } from '@panomc/sdk/plugin-api';",
        "api.get({ path: '/things/1' });",
        "api.get({ path: '/thingz' });",
        "api.panel.put({ path: `/things/${id}` });",
        "api.panel.get({ path: '/things' });",
        "const other = createPluginApi('pano-plugin-else'); other.get({ path: '/whatever' });",
      ].join('\n'),
    );
    const r = checkPaths({ root: dir, routes: routesFile(CORE) });
    expect(r.problems).toEqual([
      "src/theme/Plugin.js:3 '/thingz' is not a Pano route (did you mean '/things'?)",
      "src/theme/Plugin.js:5 '/things' is not a Pano route (did you mean '/things/:id'?)",
    ]);
  });

  test('a missing routes file is an error, not a pass', () => {
    const r = checkPaths({ root: path.join(FIXTURES, 'plugin-new'), routes: path.join(tempDir(), 'nope.json') });
    expect(r.errors.length).toBe(1);
    expect(runCli(['check-paths', '--routes', path.join(tempDir(), 'nope.json'), path.join(FIXTURES, 'plugin-new')]).code).toBe(2);
  });

  test('CLI exit codes', () => {
    const f = routesFile(CORE);
    expect(runCli(['check-paths', '--routes', f, path.join(FIXTURES, 'plugin-new')]).code).toBe(0);
    expect(runCli(['check-paths', '--routes', f, path.join(FIXTURES, 'plugin-old')]).code).toBe(1);
  });
});

describe('helpers', () => {
  test('fits: holes and parameters are wildcards, segment counts must agree', () => {
    expect(fits('/posts/${x}', '/posts/:url')).toBe(true);
    expect(fits('/posts/file-${x}.png', '/posts/:name')).toBe(true);
    expect(fits('/posts/${x}', '/posts')).toBe(false);
    expect(fits('/posts/a', '/posts/b')).toBe(false);
    expect(fits('/panel/${seg}/x', '/panel/anything/x')).toBe(true);
  });

  test('suggest only offers close routes', () => {
    expect(suggest('/panel/addon', ['/panel/addons', '/posts'])).toBe('/panel/addons');
    expect(suggest('/zzzzzzzzzzzzzzzz', ['/panel/addons', '/posts'])).toBe(null);
  });

  test('collectCalls reads path: of ApiUtil and api calls with their line', () => {
    const calls = collectCalls("import ApiUtil from '@panomc/sdk/utils/api';\n\nApiUtil.post({\n  path: `/a/${b}`,\n  body });");
    expect(calls.map((c) => [c.line, c.literal, c.kind])).toEqual([[4, '/a/${b}', 'core']]);
  });
});

describe('the JS file walk', () => {
  test('skips __tests__ folders, so test strings are never read as client calls', () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, 'src/__tests__'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src/sub/__tests__/deep'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/api.js'), "ApiUtil.get({ path: '/site-info' });\n");
    fs.writeFileSync(path.join(dir, 'src/__tests__/api.test.js'), "ApiUtil.get({ path: '/nope' });\n");
    fs.writeFileSync(path.join(dir, 'src/sub/__tests__/deep/x.js'), "ApiUtil.get({ path: '/nope' });\n");
    const files = walk(dir, { exts: ['.js'] }).map((f) => path.relative(dir, f));
    expect(files).toEqual(['src/api.js']);
    const result = checkPaths({ root: dir, routes: routesFile(CORE) });
    expect(JSON.stringify(result)).not.toContain('/nope');
  });
});
