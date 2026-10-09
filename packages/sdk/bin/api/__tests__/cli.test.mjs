import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURES, cleanup, runCli, tempDir } from './helpers.mjs';

afterAll(cleanup);

describe('pano-api CLI', () => {
  test('help and unknown commands', () => {
    expect(runCli(['--help']).code).toBe(0);
    expect(runCli(['--help']).stdout).toContain('migrate-v1');
    expect(runCli([]).code).toBe(1);
    expect(runCli(['frobnicate']).code).toBe(1);
    expect(runCli(['migrate-v1', '--bogus']).code).toBe(2);
  });

  test('extract-routes prints JSON on stdout', () => {
    const r = runCli(['extract-routes', path.join(FIXTURES, 'plugin-new')]);
    expect(r.code).toBe(0);
    const routes = JSON.parse(r.stdout);
    expect(routes.length).toBe(8);
    expect(routes[0]).toHaveProperty('path');
  });

  test('api-compat compares two files', () => {
    const dir = tempDir();
    const op = { get: { responses: { 200: { description: 'ok' } } } };
    fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ paths: { '/x': op, '/y': op } }));
    fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify({ paths: { '/x': op } }));
    const bad = runCli(['api-compat', path.join(dir, 'a.json'), path.join(dir, 'b.json')]);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain('GET /y: operation was removed');
    expect(runCli(['api-compat', path.join(dir, 'b.json'), path.join(dir, 'a.json')]).code).toBe(0);
  });

  test('--check is idempotent end to end: old tree fails, migrate, then check passes', () => {
    const dir = tempDir();
    fs.cpSync(path.join(FIXTURES, 'plugin-old'), dir, { recursive: true });
    expect(runCli(['migrate-v1', '--check', '--strip', 'demo', dir]).code).toBe(1);
    expect(runCli(['migrate-v1', '--strip', 'demo', dir]).code).toBe(0);
    expect(runCli(['migrate-v1', '--check', '--strip', 'demo', dir]).code).toBe(0);
    expect(runCli(['migrate-v1', '--strip', 'demo', dir]).stderr).toContain('0 file(s) changed');
  });
});
