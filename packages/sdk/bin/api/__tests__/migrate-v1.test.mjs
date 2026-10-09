import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { migrateV1, errorCodeOf, newDeclared, addApiLevelHelper } from '../migrate-v1.mjs';
import { rewriteResults, rewritePathLiterals, mapClientPath } from '../js-scan.mjs';
import { FIXTURES, cleanup, copyFixture, runCli, snapshot } from './helpers.mjs';

afterAll(cleanup);

const quiet = async (fn) => {
  const e = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = e;
  }
};

describe('plugin migration against the golden fixture', () => {
  test('old fixture -> plugin-new, every step', async () => {
    const dir = copyFixture('plugin-old');
    const r = await quiet(() => migrateV1({ root: dir, strip: 'demo' }));
    expect(r.errors).toEqual([]);
    expect(r.leftovers).toEqual([]);
    expect(snapshot(dir)).toEqual(snapshot(path.join(FIXTURES, 'plugin-new')));
  });

  test('a second run changes nothing and --check agrees', async () => {
    const dir = copyFixture('plugin-new');
    const before = snapshot(dir);
    const again = await quiet(() => migrateV1({ root: dir, strip: 'demo' }));
    expect(again.changes.size).toBe(0);
    expect(snapshot(dir)).toEqual(before);
    const check = await quiet(() => migrateV1({ root: dir, strip: 'demo', check: true }));
    expect(check.changes.size).toBe(0);
    expect(check.leftovers).toEqual([]);
  });

  test('--check on the old tree writes nothing and reports what would change', async () => {
    const dir = copyFixture('plugin-old');
    const before = snapshot(dir);
    const r = await quiet(() => migrateV1({ root: dir, strip: 'demo', check: true }));
    expect(snapshot(dir)).toEqual(before);
    expect([...r.changes.keys()]).toContain('src/main/kotlin/com/example/demo/error/Errors.kt');
    expect(runCli(['migrate-v1', '--check', '--strip', 'demo', dir]).code).toBe(1);
  });

  test('acceptance: --check on the migrated fixture exits 0', () => {
    const r = runCli(['migrate-v1', '--check', path.join(FIXTURES, 'plugin-new')]);
    expect(r.code).toBe(0);
  });
});

describe('step a: Kotlin paths', () => {
  const run = async (strip) => {
    const dir = copyFixture('plugin-old');
    await quiet(() => migrateV1({ root: dir, strip, only: ['a'] }));
    return dir;
  };
  const kt = (dir, file) => fs.readFileSync(path.join(dir, 'src/main/kotlin/com/example/demo/routes', file), 'utf8');

  test('--strip removes the plugin segment, /panel goes for a PanelApi, other segments stay', async () => {
    const dir = await run('demo');
    expect(kt(dir, 'GetThingsAPI.kt')).toContain('Path("/things", RouteType.GET)');
    expect(kt(dir, 'GetThingsAPI.kt')).toContain('Path("/other/list", RouteType.GET)');
    expect(kt(dir, 'PanelThingAPI.kt')).toContain('Path("/things/:id", RouteType.PUT)');
  });

  test('without --strip only /api and /panel go', async () => {
    const dir = await run(undefined);
    expect(kt(dir, 'GetThingsAPI.kt')).toContain('Path("/demo/things", RouteType.GET)');
    expect(kt(dir, 'PanelThingAPI.kt')).toContain('Path("/demo/things/:id", RouteType.PUT)');
  });

  test('const val paths are rewritten where they are defined, templates and concatenation keep working', async () => {
    const dir = await run('demo');
    const src = kt(dir, 'WebhookAPI.kt');
    expect(src).toContain('const val WEBHOOK_PATH = "/webhook/:id"');
    expect(src).toContain('const val RETURN_PATH = "/payments/:providerId/return"');
    expect(src).toContain('Path("$WEBHOOK_PATH/:channel", RouteType.ROUTE)');
    expect(src).toContain('Path(Inbound.RETURN_PATH + "/:name", RouteType.GET)');
  });

  test('strings that are not Path declarations are untouched', async () => {
    const dir = await run('demo');
    expect(kt(dir, 'ValidatedAPI.kt')).toContain('val doc = "see /api/demo/validated"');
  });

  test('writes api/paths.old-new.json with full old and new paths, merged on later runs', async () => {
    const dir = await run('demo');
    const pairs = JSON.parse(fs.readFileSync(path.join(dir, 'api/paths.old-new.json'), 'utf8'));
    const panel = pairs.find((p) => p.old === '/api/panel/demo/things/:id');
    expect(panel).toMatchObject({ method: 'PUT', new: '/api/plugins/pano-plugin-demo/panel/things/:id', relative: '/plugins/pano-plugin-demo/panel/things/:id' });
    const site = pairs.find((p) => p.old === '/api/demo/things');
    expect(site.new).toBe('/api/plugins/pano-plugin-demo/things');
    await quiet(() => migrateV1({ root: dir, strip: 'demo', only: ['a'] }));
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'api/paths.old-new.json'), 'utf8'))).toEqual(pairs);
  });

  test('newDeclared: core renames, panel prefix, strip', () => {
    const core = { isCore: true, namespace: 'SITE' };
    expect(newDeclared('/api/siteInfo', core)).toBe('/site-info');
    expect(newDeclared('/api/auth/verifyLinkCode', core)).toBe('/auth/verify-link-code');
    expect(newDeclared('/api/ticket/categories', core)).toBe('/ticket-categories');
    expect(newDeclared('/api/post/thumbnail/:filename', core)).toBe('/posts/thumbnails/:filename');
    expect(newDeclared('/api/notifications/quick/markAsRead', core)).toBe('/notifications/quick/mark-as-read');
    expect(newDeclared('/api/panel/plugins/:pluginId/license', { isCore: true, namespace: 'PANEL' })).toBe('/addons/:pluginId/license');
    expect(newDeclared('/api/panel/market/products', { isCore: false, strip: 'market', namespace: 'PANEL' })).toBe('/products');
    expect(newDeclared('/api/market', { isCore: false, strip: 'market', namespace: 'SITE' })).toBe('/');
    expect(newDeclared('/api/marketing/x', { isCore: false, strip: 'market', namespace: 'SITE' })).toBe('/marketing/x');
  });
});

describe('core migration', () => {
  test('old core fixture -> core-new (renames, overrides, error codes, pairs under Pano/api)', async () => {
    const dir = copyFixture('core-old');
    const r = await quiet(() => migrateV1({ root: dir }));
    expect(r.errors).toEqual([]);
    expect(snapshot(dir)).toEqual(snapshot(path.join(FIXTURES, 'core-new')));
    expect(r.warnings.join('\n')).toContain('Banned extends the error class NotExists');
  });

  test('a PanelApi serving a path outside /panel and a site class under /api/panel are reported when no override exists', async () => {
    const dir = copyFixture('core-old');
    const f = path.join(dir, 'Pano/src/main/kotlin/com/panomc/platform/route/api/panel/PanelAddonsAPI.kt');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/    override val namespace = Namespace\.\w+\n/g, ''));
    const r = await quiet(() => migrateV1({ root: dir, only: ['a'], check: true }));
    const w = r.warnings.join('\n');
    expect(w).toContain('PanelGetDefaultServerIconAPI is a PanelApi serving /api/server/icon/default');
    expect(w).toContain('PanelIsUserExistsAPI extends Api but serves /api/panel/players/:username/exists');
  });
});

describe('step b: error codes', () => {
  test('errorCodeOf matches TextUtil.convertToSnakeCase().uppercase()', () => {
    expect(errorCodeOf('EmptyCart')).toBe('EMPTY_CART');
    expect(errorCodeOf('TwoFactorInvalidCode')).toBe('TWO_FACTOR_INVALID_CODE');
    expect(errorCodeOf('NotExists')).toBe('NOT_EXISTS');
    expect(errorCodeOf('HTTPError')).toBe('HTTPERROR');
    expect(errorCodeOf('Oauth2Failed')).toBe('OAUTH2FAILED');
  });

  test('rewrites every supertype call to Error( to a literal UPPER_SNAKE code, whatever the arguments', async () => {
    const dir = copyFixture('plugin-old');
    await quiet(() => migrateV1({ root: dir, only: ['b'] }));
    const src = fs.readFileSync(path.join(dir, 'src/main/kotlin/com/example/demo/error/Errors.kt'), 'utf8');
    expect(src).toContain('class EmptyCart : Error("EMPTY_CART", 400)');
    expect(src).toContain('class NotFoundThing(extras: Map<String, Any?> = mapOf()) : Error("NOT_FOUND_THING", 404, extras = extras)');
    expect(src).toContain('class TwoFactorRequired : Error("TWO_FACTOR_REQUIRED")');
    expect(src).toContain('class MultiLine : Error("MULTI_LINE",\n    403,');
    expect(src).toContain('class AlreadyMigrated : Error("ALREADY_MIGRATED", 409)');
  });

  test('a class that does not import the platform Error is left alone', async () => {
    const dir = copyFixture('plugin-old');
    await quiet(() => migrateV1({ root: dir, only: ['b'] }));
    expect(fs.readFileSync(path.join(dir, 'src/main/kotlin/com/example/demo/error/Plain.kt'), 'utf8')).toContain('Error("just a message")');
  });
});

describe('step c: validation import prefix', () => {
  test('class and member imports move to the schema dsl, other vertx imports stay', async () => {
    const dir = copyFixture('plugin-old');
    await quiet(() => migrateV1({ root: dir, only: ['c'] }));
    const src = fs.readFileSync(path.join(dir, 'src/main/kotlin/com/example/demo/routes/ValidatedAPI.kt'), 'utf8');
    expect(src).toContain('import com.panomc.platform.schema.dsl.Bodies.json');
    expect(src).toContain('import com.panomc.platform.schema.dsl.Parameters.param');
    expect(src).toContain('import com.panomc.platform.schema.dsl.ValidationHandlerBuilder');
    expect(src).toContain('import io.vertx.ext.web.validation.ValidationHandler\n');
    expect(src).not.toContain('validation.builder');
  });
});

describe('step d: api-level helper', () => {
  test('adds the helper and the manifest attribute once', () => {
    const src = fs.readFileSync(path.join(FIXTURES, 'plugin-old/build.gradle.kts'), 'utf8');
    const r = addApiLevelHelper(src);
    expect(r.changed).toBe(true);
    expect(r.text).toContain('val panoApiLevel: String? by lazy');
    expect(r.text).toContain('rootProject.findProperty("panoApiLevel")');
    expect(r.text).toContain('pano-api-level.properties');
    expect(r.text).toContain('        panoApiLevel?.let { attributes["api-level"] = it }'.replace('        ', '            '));
    expect(addApiLevelHelper(r.text).changed).toBe(false);
  });

  test('the helper uses short names with the two imports at the top (inside a Gradle script java. is the java {} extension)', () => {
    const src = fs.readFileSync(path.join(FIXTURES, 'plugin-old/build.gradle.kts'), 'utf8');
    const { text } = addApiLevelHelper(src);
    expect(text.startsWith('import java.util.Properties\nimport java.util.zip.ZipFile\n')).toBe(true);
    expect(text).toContain('else ZipFile(jar).use');
    expect(text).toContain('Properties().apply');
    expect(text).not.toContain('java.util.zip.ZipFile(');
    expect(text).not.toContain('java.util.Properties()');
  });

  test('imports go below a leading comment and are not doubled when the script already has them', () => {
    const body = 'plugins { kotlin("jvm") }\ntasks {\n    shadowJar {\n        manifest {\n            attributes["id"] = "x"\n        }\n    }\n}\n';
    const { text } = addApiLevelHelper('// header\nimport java.util.Properties\n\n' + body);
    expect(text.match(/import java\.util\.Properties/g)).toHaveLength(1);
    expect(text.match(/import java\.util\.zip\.ZipFile/g)).toHaveLength(1);
    expect(text.indexOf('import java.util.zip.ZipFile')).toBeLessThan(text.indexOf('plugins {'));
    expect(text.startsWith('// header\n')).toBe(true);
    expect(addApiLevelHelper(text).changed).toBe(false);
    const both = addApiLevelHelper('// header\nimport java.util.Properties\nimport java.util.zip.ZipFile\n\n' + body).text;
    expect(both.match(/^import /gm)).toHaveLength(2);
    expect(both).toContain('panoApiLevel?.let');
  });

  test('a helper written by the earlier version (fully qualified names) is repaired once', () => {
    const old = [
      'plugins { kotlin("jvm") }',
      '// api-level',
      'val panoApiLevel: String? by lazy {',
      '    java.util.zip.ZipFile(jar).use { z -> java.util.Properties().apply { } }',
      '}',
      '',
    ].join('\n');
    const r = addApiLevelHelper(old);
    expect(r.changed).toBe(true);
    expect(r.text).toContain('ZipFile(jar).use');
    expect(r.text).not.toContain('java.util.zip.ZipFile(');
    expect(r.text.startsWith('import java.util.Properties\nimport java.util.zip.ZipFile\n')).toBe(true);
    expect(addApiLevelHelper(r.text).changed).toBe(false);
  });

  test('a build file without a manifest block is left alone', () => {
    expect(addApiLevelHelper('plugins { kotlin("jvm") }\n').changed).toBe(false);
  });
});

describe('step e: client path literals', () => {
  const ctx = {
    strip: 'demo', pluginId: 'pano-plugin-demo',
    pairs: [
      { method: 'GET', old: '/api/demo/things/:id', new: '/api/plugins/pano-plugin-demo/things/:id', relative: '/plugins/pano-plugin-demo/things/:id' },
      { method: 'GET', old: '/api/demo/things/featured', new: '/api/plugins/pano-plugin-demo/featured', relative: '/plugins/pano-plugin-demo/featured' },
    ],
  };

  test('path: relative, src/href/fetch/WebSocket absolute under /api/v1', () => {
    const src = [
      "ApiUtil.get({ path: '/api/siteInfo' });",
      'fetch(`/api/panel/plugins/${id}?x=1`);',
      '<img src="/api/websiteLogo" /><a href={`${base}/api/demo/things/${id}`}>',
      'new WebSocket("wss://host/api/ws");',
      "const route = { path: '/api/not-through-this-rule' }.other; const view = { slot: '/api/x' };",
    ].join('\n');
    const { text } = rewritePathLiterals(src, ctx);
    expect(text).toContain("ApiUtil.get({ path: '/site-info' });");
    expect(text).toContain('fetch(`/api/v1/panel/addons/${id}?x=1`);');
    expect(text).toContain('src="/api/v1/website-logo"');
    expect(text).toContain('href={`${base}/api/plugins/pano-plugin-demo/things/${id}`}');
    expect(text).toContain('new WebSocket("wss://host/api/v1/ws");');
    expect(text).toContain("const view = { slot: '/api/x' };");
  });

  test('the most specific pair wins, then the core table, then --strip, then the plain /api drop', () => {
    expect(mapClientPath('/demo/things/featured', ctx).path).toBe('/plugins/pano-plugin-demo/featured');
    expect(mapClientPath('/demo/things/${id}', ctx).path).toBe('/plugins/pano-plugin-demo/things/${id}');
    expect(mapClientPath('/ticket/categories', ctx)).toEqual({ path: '/ticket-categories', how: 'core' });
    expect(mapClientPath('/demo/other', ctx)).toEqual({ path: '/plugins/pano-plugin-demo/other', how: 'strip' });
    expect(mapClientPath('/panel/demo/other', ctx).path).toBe('/plugins/pano-plugin-demo/panel/other');
    expect(mapClientPath('/posts', ctx)).toEqual({ path: '/posts', how: 'generic' });
  });

  test('text after the matched path stays: ${queryParams} survives', () => {
    const pairs = [
      { method: 'GET', old: '/api/staff/config', new: 'x', relative: '/staff/config' },
      { method: 'GET', old: '/api/staff/:id', new: 'x', relative: '/staff/:id' },
    ];
    const text = (src) => rewritePathLiterals(src, { pairs }).text;
    expect(text('ApiUtil.get({ path: `/panel/api/staff/${id}${queryParams}` });')).toBe('ApiUtil.get({ path: `/staff/${id}${queryParams}` });');
    expect(text('ApiUtil.get({ path: `/api/staff/config${queryParams}` });')).toBe('ApiUtil.get({ path: `/staff/config${queryParams}` });');
    expect(text('fetch(`/api/siteInfo${suffix}`);')).toBe('fetch(`/api/v1/site-info${suffix}`);');
    expect(text('ApiUtil.get({ path: `/api/staff/config?a=${a}` });')).toBe('ApiUtil.get({ path: `/staff/config?a=${a}` });');
  });

  test('a path with a ${} hole maps only onto a route with a parameter at that position', () => {
    const onlyFixed = { pairs: [{ method: 'GET', old: '/api/staff/config', new: 'x', relative: '/staff/config' }] };
    expect(mapClientPath('/staff/${id}', onlyFixed)).toEqual({ path: '/staff/${id}', how: 'generic' });
    expect(rewritePathLiterals('ApiUtil.get({ path: `/panel/api/staff/${id}` });', onlyFixed).text).toBe('ApiUtil.get({ path: `/staff/${id}` });');
    const both = { pairs: [...onlyFixed.pairs, { method: 'GET', old: '/api/staff/:id', new: 'x', relative: '/staff/:id' }] };
    expect(mapClientPath('/staff/${id}', both)).toEqual({ path: '/staff/${id}', how: 'pair' });
    expect(mapClientPath('/staff/config', both).path).toBe('/staff/config');
    // a hole never names a fixed core rename either
    expect(mapClientPath('/auth/${action}', {})).toEqual({ path: '/auth/${action}', how: 'generic' });
  });

  test('already migrated literals and /panel/api aliases', () => {
    expect(rewritePathLiterals("fetch('/api/v1/posts')", ctx).count).toBe(0);
    expect(rewritePathLiterals("fetch('/panel/api/panel/basicData')", ctx).text).toBe("fetch('/api/v1/panel/basicData')");
  });
});

describe('step f: result reads only on API values', () => {
  test('rewrites reads on variables that receive client call results', () => {
    const src = `
const a = await ApiUtil.get({ path: '/x' });
if (a.error === 'NOT_FOUND') {}
if (a.error !== "BANNED") {}
if (a.result === 'ok') {}
if (a.result !== 'ok') {}
if (a.result === 'error' || a.result == "errors") {}
const f = a.errors;
if (a?.error === 'X') {}
`;
    const { text, count } = rewriteResults(src);
    expect(count).toBe(8);
    expect(text).toContain("if (a.error?.code === 'NOT_FOUND') {}");
    expect(text).toContain('if (a.error?.code !== "BANNED") {}');
    expect(text).toContain('if (!a.error) {}');
    expect(text).toContain('if (!!a.error) {}');
    expect(text).toContain('if (!!a.error || !!a.error) {}');
    expect(text).toContain('const f = a.error?.fields;');
    expect(text).toContain("if (a?.error?.code === 'X') {}");
  });

  test('leaves other values alone and tracks .then parameters and plugin-api clients', () => {
    const src = `
import { api } from '@panomc/sdk/plugin-api';
const other = { error: 'X', result: 'ok', errors: {} };
if (other.error === 'X' && other.result === 'ok') console.log(other.errors);
const body = await api.panel.post({ path: '/save' });
if (body.result === 'ok') {}
api.get({ path: '/list' }).then((res) => res.error === 'LATE');
function plain(data) { return data.result === 'ok' || data.error === 'Z'; }
const mine = createPluginApi('p');
`;
    const { text } = rewriteResults(src);
    expect(text).toContain("other.error === 'X' && other.result === 'ok'");
    expect(text).toContain('console.log(other.errors)');
    expect(text).toContain('if (!body.error) {}');
    expect(text).toContain("res.error?.code === 'LATE'");
    expect(text).toContain("data.result === 'ok' || data.error === 'Z'");
  });

  test('is idempotent', () => {
    const once = rewriteResults("const a = await ApiUtil.get({ path: '/x' }); if (a.error === 'E') {}").text;
    expect(rewriteResults(once)).toEqual({ text: once, count: 0 });
  });
});

describe('leftovers in --check', () => {
  test('/api/ literals in Kotlin, .result comparisons and totalPage are reported', async () => {
    const dir = copyFixture('plugin-new');
    fs.writeFileSync(path.join(dir, 'src/main/kotlin/com/example/demo/Left.kt'), 'package x\nval u = "/api/old"\n// "/api/in-comment"\n');
    fs.writeFileSync(path.join(dir, 'src/theme/left.js'), "if (x.result === 'ok') {}\nconst n = res.totalPage;\nfetch('/api/old');\nconst hook = origin + '/api/';\n");
    const r = await quiet(() => migrateV1({ root: dir, check: true }));
    const whats = r.leftovers.map((l) => `${l.file}:${l.line} ${l.what}`).sort();
    expect(whats).toEqual([
      'src/main/kotlin/com/example/demo/Left.kt:2 "/api/ literal',
      'src/theme/left.js:1 .result comparison',
      'src/theme/left.js:2 totalPage',
    ]);
    expect([...r.changes.get('src/theme/left.js')]).toContain('e'); // the path literal is a change, not a leftover
    expect(runCliExit(dir)).toBe(1);
  });
});

function runCliExit(dir) {
  return runCli(['migrate-v1', '--check', dir]).code;
}

describe('--only', () => {
  test('runs just the named steps', async () => {
    const dir = copyFixture('plugin-old');
    const r = await quiet(() => migrateV1({ root: dir, strip: 'demo', only: ['b', 'c'] }));
    const steps = new Set([...r.changes.values()].flatMap((s) => [...s]));
    expect([...steps].sort()).toEqual(['b', 'c']);
    expect(fs.existsSync(path.join(dir, 'api/paths.old-new.json'))).toBe(false);
  });

  test('the CLI refuses a bad letter', () => {
    expect(runCli(['migrate-v1', '--only', 'z', FIXTURES]).code).toBe(2);
  });
});
