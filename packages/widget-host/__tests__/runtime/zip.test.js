// TC-38: dist/widget-runtime.zip and scripts/install-local.js.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { installLocal } from '../../scripts/install-local.js';
import { crc32, readZip, writeZip } from '../../scripts/zip.js';
import { BUDGET, PACKAGE_DIR, RUNTIME_DIR, ZIP_FILE, kb, requireBuild, runtimeFiles } from './helpers.js';

let work;
beforeAll(() => {
  requireBuild();
  work = mkdtempSync(join(tmpdir(), 'widget-runtime-test-'));
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('zip.js', () => {
  test('crc32 of a known string', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  test('write -> read round trip, sorted and deterministic', () => {
    const entries = [
      { name: 'b/two.txt', data: Buffer.from('two '.repeat(100)) },
      { name: 'a.txt', data: Buffer.from('one') },
      { name: 'c.bin', data: Buffer.from([0, 255, 1, 254]) },
    ];
    const zip = writeZip(entries);
    expect(writeZip([...entries].reverse()).equals(zip)).toBe(true);
    const back = readZip(zip);
    expect(back.map((e) => e.name)).toEqual(['a.txt', 'b/two.txt', 'c.bin']);
    expect(back[1].data.toString()).toBe('two '.repeat(100));
    expect([...back[2].data]).toEqual([0, 255, 1, 254]);
  });

  test('a corrupt entry is refused', () => {
    const zip = Buffer.from(writeZip([{ name: 'a.txt', data: Buffer.from('hello world hello world') }]));
    zip[zip.indexOf(Buffer.from('a.txt')) + 6] ^= 0xff; // flips a byte of the stored/deflated body
    expect(() => readZip(zip)).toThrow();
  });
});

describe('dist/widget-runtime.zip', () => {
  test('exists and holds exactly the files of dist/runtime', () => {
    expect(existsSync(ZIP_FILE)).toBe(true);
    const size = statSync(ZIP_FILE).size;
    console.log(`widget-runtime.zip: ${size} B (${kb(size)})`);
    expect(size).toBeLessThanOrEqual(BUDGET.zip);

    const entries = readZip(readFileSync(ZIP_FILE));
    expect(entries.map((e) => e.name)).toEqual(runtimeFiles());
    for (const { name, data } of entries) expect(data.equals(readFileSync(join(RUNTIME_DIR, name)))).toBe(true);
  });

  test('unzip -t accepts it (a standard reader)', () => {
    const r = spawnSync('unzip', ['-tq', ZIP_FILE], { encoding: 'utf8' });
    if (r.error) return; // no unzip on this machine
    expect(r.status).toBe(0);
  });
});

describe('install-local.js', () => {
  test('unpacks to <pano dir>/widget-runtime/ and replaces an older install', () => {
    const pano = join(work, 'pano');
    mkdirSync(join(pano, 'widget-runtime'), { recursive: true });
    writeFileSync(join(pano, 'widget-runtime/stale.js'), 'old');

    const { target, files } = installLocal(pano);
    expect(target).toBe(join(pano, 'widget-runtime'));
    expect(files).toBe(runtimeFiles().length);
    expect(existsSync(join(target, 'stale.js'))).toBe(false);
    for (const f of runtimeFiles()) expect(readFileSync(join(target, f)).equals(readFileSync(join(RUNTIME_DIR, f)))).toBe(true);
    expect(readdirSync(pano)).toEqual(['widget-runtime']); // no staging folder left behind
  });

  test('the command line does the same and exits 1 for a missing folder', () => {
    const pano = join(work, 'pano-cli');
    mkdirSync(pano);
    const ok = spawnSync('node', [join(PACKAGE_DIR, 'scripts/install-local.js'), pano], { encoding: 'utf8' });
    expect(ok.status).toBe(0);
    expect(existsSync(join(pano, 'widget-runtime/loader.js'))).toBe(true);

    const bad = spawnSync('node', [join(PACKAGE_DIR, 'scripts/install-local.js'), join(work, 'nope')], { encoding: 'utf8' });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('is not a directory');
  });

  test('refuses an entry that leaves the target folder and a zip that is no runtime', () => {
    const pano = join(work, 'pano-evil');
    mkdirSync(pano);
    const evil = join(work, 'evil.zip');
    writeFileSync(evil, writeZip([{ name: 'loader.js', data: Buffer.from('x') }, { name: '../escape.txt', data: Buffer.from('x') }]));
    expect(() => installLocal(pano, evil)).toThrow('leaves the target folder');
    expect(existsSync(join(work, 'escape.txt'))).toBe(false);
    expect(readdirSync(pano)).toEqual([]);

    const empty = join(work, 'empty.zip');
    writeFileSync(empty, writeZip([{ name: 'readme.txt', data: Buffer.from('x') }]));
    expect(() => installLocal(pano, empty)).toThrow('no loader.js');
  });
});
