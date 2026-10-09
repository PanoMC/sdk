import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { extractRoutes, checkRoutes, runExtractRoutes } from '../extract-routes.mjs';
import { FIXTURES, cleanup, runCli, tempDir } from './helpers.mjs';

afterAll(cleanup);

const byClass = (routes, cls) => routes.filter((r) => r.class === cls);

describe('extract-routes on a plugin', () => {
  const { routes, errors } = extractRoutes(path.join(FIXTURES, 'plugin-new'));

  test('reads every endpoint without errors', () => {
    expect(errors).toEqual([]);
    expect(routes.length).toBe(8);
  });

  test('finds the base class through supertypes (DemoMiddleApi -> DemoApi -> Api)', () => {
    const r = byClass(routes, 'GetThingsAPI');
    expect(r.map((x) => x.path)).toEqual([
      '/api/plugins/pano-plugin-demo/other/list',
      '/api/plugins/pano-plugin-demo/things',
      '/api/plugins/pano-plugin-demo/things/:id',
    ]);
    expect(r.every((x) => x.namespace === 'SITE' && x.pluginId === 'pano-plugin-demo')).toBe(true);
  });

  test('a PanelApi subclass lands under /panel/plugins/<id>', () => {
    const [r] = byClass(routes, 'PanelSaveThingAPI');
    expect(r.path).toBe('/api/plugins/pano-plugin-demo/panel/things/:id');
    expect(r.namespace).toBe('PANEL');
    expect(r.method).toBe('PUT');
  });

  test('resolves const val paths, templates and concatenation across objects', () => {
    const paths = byClass(routes, 'WebhookAPI').map((r) => `${r.method} ${r.declared}`);
    expect(paths).toEqual([
      'GET /payments/:providerId/return/:name',
      'ANY /webhook/:id',
      'ANY /webhook/:id/:channel',
    ]);
  });

  test('the pre-cutover form is reported as legacy and kept verbatim', () => {
    const { routes: old } = extractRoutes(path.join(FIXTURES, 'plugin-old'));
    const r = byClass(old, 'GetThingsAPI').find((x) => x.declared === '/api/demo/things');
    expect(r.legacy).toBe(true);
    expect(r.path).toBe('/api/demo/things');
    expect(checkRoutes(old).length).toBeGreaterThan(0);
  });

  test('the migrated fixture fits the scheme', () => {
    expect(checkRoutes(routes)).toEqual([]);
  });
});

describe('extract-routes on core', () => {
  const { routes, errors } = extractRoutes(path.join(FIXTURES, 'core-new'));
  const at = (cls) => routes.filter((r) => r.class === cls).map((r) => r.path);

  test('scans Pano/src/main/kotlin of a pano-web-platform checkout and finds no base classes as endpoints', () => {
    expect(errors).toEqual([]);
    expect(routes.some((r) => ['Api', 'PanelApi', 'Template'].includes(r.class))).toBe(false);
    expect(routes.every((r) => r.pluginId === null)).toBe(true);
  });

  test('namespace and mount overrides win over the base class', () => {
    expect(at('PanelGetDefaultServerIconAPI')).toEqual(['/api/v1/server/icon/default']);
    expect(at('PanelIsUserExistsAPI')).toEqual(['/api/v1/panel/players/:username/exists']);
    expect(at('HostSsoAPI')).toEqual(['/panel/host-sso']);
    expect(at('IndexTemplate')).toEqual(['/*']);
  });

  test('renames are visible in the extracted paths', () => {
    expect(at('GetSiteInfoAPI')).toEqual(['/api/v1/site-info']);
    expect(at('PanelGetAddonsAPI')).toEqual(['/api/v1/panel/addons', '/api/v1/panel/addons/search']);
    expect(at('GetPluginUiZipAPI')).toEqual(['/api/v1/plugins/:pluginId/_/ui.zip']);
    expect(checkRoutes(routes)).toEqual([]);
  });
});

describe('refusal table and failures', () => {
  test('each refusal names the class and the fix, duplicates name both classes', () => {
    const { routes } = extractRoutes(path.join(FIXTURES, 'refusals'));
    const problems = checkRoutes(routes).join('\n');
    expect(problems).toContain('LegacyAPI: path "/api/posts" starts with /api; declare "/posts", not "/api/posts"; Pano adds /api/v1 itself');
    expect(problems).toContain('NoSlashAPI: path "hello" must start with "/"; declare "/hello"');
    expect(problems).toContain('extend PanelApi and declare "/settings"; Pano adds /panel itself');
    expect(problems).toContain('put a resource name first: "/items/:id"');
    expect(problems).toMatch(/DupTwoAPI: duplicate of .*DupOneAPI/);
    expect(problems.split('\n').filter((l) => l.includes('put a resource name first')).length).toBe(2);
  });

  test('anything unresolvable fails with file and line', () => {
    const { errors } = extractRoutes(path.join(FIXTURES, 'unresolved'));
    expect(errors.map((e) => `${e.file}:${e.line}`)).toEqual([
      'src/main/kotlin/x/Orphan.kt:7',
      'src/main/kotlin/x/Orphan.kt:12',
      'src/main/kotlin/x/Orphan.kt:18',
    ]);
    expect(errors[0].message).toContain('cannot resolve its base class');
    expect(errors[2].message).toContain('MISSING_CONST');
  });

  test('--check exits 1 for problems and 2 for unreadable classes', () => {
    expect(runCli(['extract-routes', '--check', path.join(FIXTURES, 'refusals')]).code).toBe(1);
    expect(runCli(['extract-routes', '--check', path.join(FIXTURES, 'unresolved')]).code).toBe(2);
    expect(runCli(['extract-routes', '--check', path.join(FIXTURES, 'plugin-new')]).code).toBe(0);
  });
});

describe('--out / --core snapshot', () => {
  test('writes, then --check notices a stale file and accepts a current one', () => {
    const out = path.join(tempDir(), 'routes.json');
    const root = path.join(FIXTURES, 'core-new');
    const quiet = console.error;
    console.error = () => {};
    try {
      expect(runExtractRoutes({ root, core: false, check: true, out })).toBe(1); // missing
      expect(runExtractRoutes({ root, core: false, check: false, out })).toBe(0);
      expect(runExtractRoutes({ root, core: false, check: true, out })).toBe(0);
      fs.appendFileSync(out, ' ');
      expect(runExtractRoutes({ root, core: false, check: true, out })).toBe(1);
    } finally {
      console.error = quiet;
    }
    const written = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(written[0]).toHaveProperty('method');
    expect(written[0]).not.toHaveProperty('line');
  });
});
