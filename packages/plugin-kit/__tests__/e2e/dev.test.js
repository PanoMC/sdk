import { afterAll, describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { DEV_MODE_PANEL_PATH, builtJars, readDevelopmentMode, runDev } from '../../src/dev.js';
import { cleanup, makeProject, write } from './helpers.js';

afterAll(cleanup);

/** A fake rollup watcher: emits what a test tells it to and records `close`. */
function fakeWatch() {
  const emitter = new EventEmitter();
  const state = { closed: false, configs: /** @type {any[]} */ ([]) };

  return {
    state,
    emitter,
    watch(configs) {
      state.configs = configs;

      return { on: (event, handler) => emitter.on(event, handler), close: () => { state.closed = true; } };
    },
  };
}

/** A fetch that answers per path: `{ '/api/v1/site-info': body | Error | 404 }`. */
function fakeFetch(routes) {
  /** @type {string[]} */
  const calls = [];
  const request = async (url) => {
    const target = new URL(url).pathname;

    calls.push(target);

    const answer = routes[target];

    if (answer instanceof Error) throw answer;
    if (answer === undefined) return { ok: false, status: 404, json: async () => ({}) };

    return { ok: true, status: 200, json: async () => answer };
  };

  return { request, calls };
}

function collect() {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const err = [];

  return { out, err, write: (line) => out.push(line), error: (line) => err.push(line) };
}

const JAR = { 'build/libs/pano-plugin-min-1.0.0.jar': 'jar' };

describe('pano-plugin dev', () => {
  test('builds the jar once with -Pnoui when build/libs has none', async () => {
    const root = makeProject({ gradlew: '#!/bin/sh\n' });
    const log = collect();
    const watcher = fakeWatch();
    /** @type {any[]} */
    const runs = [];
    const devBefore = process.env.DEV;
    let devDuringWatch;

    const code = await runDev({
      root,
      out: log.write,
      err: log.error,
      run: (command, args, cwd) => {
        runs.push({ command, args, cwd });
        // Gradle leaves the jar behind
        write(root, JAR);

        return 0;
      },
      request: fakeFetch({ '/api/v1/site-info': { developmentMode: true } }).request,
      loadConfigs: async () => [{ input: 'x' }],
      watch: (configs) => {
        devDuringWatch = process.env.DEV;

        return watcher.watch(configs);
      },
      stop: Promise.resolve(),
    });

    expect(code).toBe(0);
    expect(runs).toEqual([{ command: './gradlew', args: ['build', '-Pnoui'], cwd: root }]);
    expect(log.out.join('\n')).toContain('restart Pano once');
    expect(log.out.join('\n')).not.toContain('Development Mode is off');
    expect(watcher.state.configs).toEqual([{ input: 'x' }]);
    expect(watcher.state.closed).toBe(true);
    expect(devDuringWatch).toBe('true');
    expect(process.env.DEV).toBe(devBefore);
  });

  test('does not build when a jar exists', async () => {
    const root = makeProject(JAR);
    const log = collect();
    let ran = false;

    expect(builtJars(root).length).toBe(1);

    await runDev({
      root,
      out: log.write,
      err: log.error,
      run: () => {
        ran = true;

        return 0;
      },
      request: fakeFetch({ '/api/v1/site-info': { developmentMode: true } }).request,
      loadConfigs: async () => [],
      watch: (configs) => fakeWatch().watch(configs),
      stop: Promise.resolve(),
    });

    expect(ran).toBe(false);
    expect(log.out.join('\n')).toContain('watching');
  });

  test('a -plain jar does not count', () => {
    const root = makeProject({ 'build/libs/x-plain.jar': 'jar' });

    expect(builtJars(root)).toEqual([]);
  });

  test('prints the panel path of the switch when Development Mode is off', async () => {
    const root = makeProject(JAR);
    const log = collect();

    await runDev({
      root,
      pano: 'http://pano.test:8088/',
      out: log.write,
      err: log.error,
      request: fakeFetch({ '/api/v1/site-info': { developmentMode: false } }).request,
      loadConfigs: async () => [],
      watch: (configs) => fakeWatch().watch(configs),
      stop: Promise.resolve(),
    });

    expect(log.out.join('\n')).toContain('Development Mode is off');
    expect(log.out.join('\n')).toContain(DEV_MODE_PANEL_PATH);
    expect(DEV_MODE_PANEL_PATH).toBe('Panel → Platform Settings → Development Mode');
  });

  test('reads site info from /api/v1/site-info, then from the pre-v1 path, and reports an unreachable Pano', async () => {
    const newer = fakeFetch({ '/api/v1/site-info': { developmentMode: true } });

    expect(await readDevelopmentMode('http://x', newer.request)).toEqual({ reachable: true, developmentMode: true });
    expect(newer.calls).toEqual(['/api/v1/site-info']);

    const older = fakeFetch({ '/api/site-info': { result: 'ok', developmentMode: false } });

    expect(await readDevelopmentMode('http://x', older.request)).toEqual({ reachable: true, developmentMode: false });
    expect(older.calls).toEqual(['/api/v1/site-info', '/api/site-info']);

    const down = fakeFetch({ '/api/v1/site-info': new Error('ECONNREFUSED') });

    expect(await readDevelopmentMode('http://x', down.request)).toEqual({ reachable: false, developmentMode: null });

    const log = collect();
    const root = makeProject(JAR);

    await runDev({
      root,
      out: log.write,
      err: log.error,
      request: down.request,
      loadConfigs: async () => [],
      watch: (configs) => fakeWatch().watch(configs),
      stop: Promise.resolve(),
    });
    expect(log.out.join('\n')).toContain('Pano is not reachable at http://localhost:8088');
  });

  test('a failing Gradle build ends the command with its exit code named', async () => {
    const root = makeProject({ gradlew: '#!/bin/sh\n' });
    const log = collect();
    let watched = false;

    const code = await runDev({
      root,
      out: log.write,
      err: log.error,
      run: () => 3,
      request: fakeFetch({}).request,
      loadConfigs: async () => [],
      watch: () => {
        watched = true;

        return fakeWatch().watch([]);
      },
      stop: Promise.resolve(),
    });

    expect(code).toBe(1);
    expect(watched).toBe(false);
    expect(log.err.join('\n')).toContain('./gradlew build -Pnoui failed (exit 3)');
  });

  test('without a jar and without gradlew it says how to build once', async () => {
    const root = makeProject();
    const log = collect();
    const code = await runDev({ root, out: log.write, err: log.error, stop: Promise.resolve() });

    expect(code).toBe(1);
    expect(log.err.join('\n')).toContain('no gradlew');
    expect(log.err.join('\n')).toContain('gradle build -Pnoui');
  });

  test('watch events: a bundle end is reported, an error makes the exit code 1', async () => {
    const root = makeProject(JAR);
    const log = collect();
    const watcher = fakeWatch();
    let stop;
    const stopped = new Promise((resolve) => (stop = resolve));

    const running = runDev({
      root,
      out: log.write,
      err: log.error,
      request: fakeFetch({ '/api/v1/site-info': { developmentMode: true } }).request,
      loadConfigs: async () => [],
      watch: (configs) => watcher.watch(configs),
      stop: stopped,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    watcher.emitter.emit('event', { code: 'START' });
    watcher.emitter.emit('event', { code: 'BUNDLE_END', duration: 7, result: { close() {} } });
    watcher.emitter.emit('event', { code: 'BUNDLE_END', duration: 5, result: { close() {} } });
    watcher.emitter.emit('event', { code: 'END' });
    watcher.emitter.emit('event', { code: 'START' });
    watcher.emitter.emit('event', { code: 'ERROR', error: new Error('[pano-plugin] min/greeter: action \'x\' removed'), result: { close() {} } });
    stop(undefined);

    expect(await running).toBe(1);
    expect(log.out.join('\n')).toContain('dev: built in 12 ms');
    expect(log.err.join('\n')).toContain("error: min/greeter: action 'x' removed");
    expect(watcher.state.closed).toBe(true);
  });

  test('the real CLI starts the watch with DEV=true and stops on SIGTERM', async () => {
    const root = makeProject(JAR);
    const { spawn } = await import('node:child_process');
    const { bin, sdkDir } = await import('./helpers.js');
    const child = spawn(process.execPath, [bin, 'dev', '--pano', 'http://127.0.0.1:9'], {
      cwd: root,
      env: { ...process.env, PANO_SDK_DIR: sdkDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';

    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));

    const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
    const deadline = Date.now() + 90000;

    while (!/dev: built in \d+ ms/.test(output) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    child.kill('SIGTERM');

    const code = await exited;

    expect(output).toMatch(/dev: built in \d+ ms/);
    expect(output).toContain('Pano is not reachable');
    expect(code).toBe(0);
    // DEV=true builds unminified with Svelte dev mode
    const client = fs.readdirSync(path.join(root, 'src/main/resources/plugin-ui/client')).find((name) => name.startsWith('HelloPage-'));

    expect(fs.readFileSync(path.join(root, 'src/main/resources/plugin-ui/client', client), 'utf8')).toContain('\n');
  }, 120000);
});
