import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { runOpenapiSnapshot, findPluginRepos } from '../openapi-snapshot.mjs';
import { stableJson } from '../util.mjs';
import { cleanup, runCli, tempDir } from './helpers.mjs';

afterAll(cleanup);

const doc = (paths) => ({ openapi: '3.1.0', info: { title: 'Pano', version: '1' }, paths });
const getOp = (props) => ({
  get: { responses: { 200: { description: 'ok', content: { 'application/json': { schema: { type: 'object', properties: props } } } } } },
});

/** @type {Record<string, any>} */
let served;
let server;
let base;

beforeEach(() => {
  served = {
    '/api/v1/openapi.json': doc({ '/posts': getOp({ items: { type: 'array' } }) }),
    '/api/v1/panel/openapi.json': doc({ '/panel/x': getOp({}) }),
    '/api/v1/plugins/pano-plugin-demo/_/openapi.json': doc({ '/things': getOp({ id: { type: 'integer' } }) }),
  };
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const body = served[new URL(req.url).pathname];
      return body ? Response.json(body) : new Response('{}', { status: 404 });
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});
afterEach(() => server.stop(true));

/** A workspace: Pano/api for core, plugins/<id> with a gradle.properties. */
function workspace(withPlugin = true) {
  const root = tempDir();
  fs.mkdirSync(path.join(root, 'Pano', 'api'), { recursive: true });
  if (withPlugin) {
    fs.mkdirSync(path.join(root, 'plugins', 'pano-plugin-demo'), { recursive: true });
    fs.writeFileSync(path.join(root, 'plugins', 'pano-plugin-demo', 'gradle.properties'), 'pluginId=pano-plugin-demo\n');
  }
  return { root, coreDir: path.join(root, 'Pano', 'api'), pluginsDir: path.join(root, 'plugins') };
}
const quiet = async (fn) => {
  const e = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = e;
  }
};
const run = (ws, extra) => quiet(() => runOpenapiSnapshot({ url: base, coreDir: ws.coreDir, pluginsDir: ws.pluginsDir, ...extra }));

describe('openapi-snapshot', () => {
  test('finds plugin repositories by their gradle.properties', () => {
    const ws = workspace();
    expect(findPluginRepos(ws.pluginsDir).map((r) => r.id)).toEqual(['pano-plugin-demo']);
  });

  test('--check fails while snapshots are missing, --write creates the three files, --check then passes', async () => {
    const ws = workspace();
    expect(await run(ws, { check: true })).toBe(1);
    expect(await run(ws, { write: true })).toBe(0);
    expect(fs.existsSync(path.join(ws.coreDir, 'openapi-core.json'))).toBe(true);
    expect(fs.existsSync(path.join(ws.coreDir, 'openapi-internal.json'))).toBe(true);
    expect(fs.readFileSync(path.join(ws.pluginsDir, 'pano-plugin-demo', 'api', 'openapi.json'), 'utf8')).toBe(stableJson(served['/api/v1/plugins/pano-plugin-demo/_/openapi.json']));
    expect(await run(ws, { check: true })).toBe(0);
    expect(await run(ws, { write: true })).toBe(0);
  });

  test('an additive change makes --check fail (stale snapshot) without being a break', async () => {
    const ws = workspace();
    await run(ws, { write: true });
    served['/api/v1/openapi.json'].paths['/tags'] = getOp({});
    expect(await run(ws, { check: true })).toBe(1);
    expect(await run(ws, { write: true })).toBe(0);
    expect(await run(ws, { check: true })).toBe(0);
  });

  test('a removed operation is refused on --write unless --allow-breaks, and fails --check', async () => {
    const ws = workspace();
    await run(ws, { write: true });
    delete served['/api/v1/openapi.json'].paths['/posts'];
    expect(await run(ws, { check: true })).toBe(1);
    expect(await run(ws, { write: true })).toBe(1);
    expect(JSON.parse(fs.readFileSync(path.join(ws.coreDir, 'openapi-core.json'), 'utf8')).paths['/posts']).toBeDefined();
    expect(await run(ws, { write: true, allowBreaks: true })).toBe(0);
  });

  test('a deprecated operation whose removal date has passed may disappear', async () => {
    const ws = workspace();
    served['/api/v1/openapi.json'].paths['/old'] = { get: { ...getOp({}).get, deprecated: true, 'x-pano-removal': '2026-01-01', 'x-pano-deprecated-on': '2025-01-01' } };
    await run(ws, { write: true });
    delete served['/api/v1/openapi.json'].paths['/old'];
    expect(await run(ws, { write: true, today: '2026-10-08' })).toBe(0);
  });

  test('a plugin the instance does not serve is skipped, a missing core document is an error', async () => {
    const ws = workspace();
    delete served['/api/v1/plugins/pano-plugin-demo/_/openapi.json'];
    expect(await run(ws, { write: true })).toBe(0);
    expect(fs.existsSync(path.join(ws.pluginsDir, 'pano-plugin-demo', 'api', 'openapi.json'))).toBe(false);
    delete served['/api/v1/openapi.json'];
    expect(await run(ws, { write: true })).toBe(2);
  });

  test('an unreachable instance exits 2', async () => {
    const ws = workspace();
    expect(await quiet(() => runOpenapiSnapshot({ url: 'http://127.0.0.1:1', coreDir: ws.coreDir, write: true }))).toBe(2);
  });

  test('the CLI needs --url and --write or --check', () => {
    expect(runCli(['openapi-snapshot', '--write']).code).toBe(2);
    expect(runCli(['openapi-snapshot', '--url', 'http://x']).code).toBe(2);
  });
});
