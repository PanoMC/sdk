import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const kitDir = path.resolve(here, '../..');
export const themeCore = path.resolve(kitDir, '../..');
export const fixtureDir = path.join(themeCore, 'test-fixtures/plugin-min');
export const styleFixtureDir = path.join(themeCore, 'test-fixtures/plugin-style');
export const sdkDir = path.join(themeCore, 'packages/sdk');
export const bin = path.join(kitDir, 'bin/pano-plugin.js');
export const PACKAGE = 'src/main/resources/plugin-ui';

/** @type {string[]} */
const created = [];

export function cleanup() {
  for (const folder of created.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
}

/**
 * Copies `test-fixtures/plugin-min` (sources only) to a throw-away folder. `node_modules` is linked to
 * the workspace one, so the copy resolves `@panomc/plugin-kit/rollup` and rollup like the original.
 * `extra` adds or replaces files (`null` removes one); `from` names another fixture folder.
 *
 * @param {Record<string, string | null>} [extra]
 * @param {string} [from]
 * @returns {string} absolute project root
 */
export function makeProject(extra = {}, from = fixtureDir) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pano-kit-e2e-'));

  created.push(root);

  const copy = (from, to) => {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'main' || entry.name === '.gitignore') continue;

      const source = path.join(from, entry.name);
      const target = path.join(to, entry.name);

      if (entry.isDirectory()) {
        fs.mkdirSync(target, { recursive: true });
        copy(source, target);
      } else {
        fs.copyFileSync(source, target);
      }
    }
  };

  copy(from, root);
  // the committed lock belongs to the fixture; a copy starts without one unless the test brings its own
  fs.rmSync(path.join(root, 'pano-plugin.lock.json'), { force: true });
  fs.symlinkSync(path.join(themeCore, 'node_modules'), path.join(root, 'node_modules'));

  write(root, extra);

  return root;
}

/**
 * @param {string} root
 * @param {Record<string, string | null>} files
 */
export function write(root, files) {
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, relative);

    if (content === null) {
      fs.rmSync(file, { force: true });
      continue;
    }

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

/**
 * @param {string} root
 * @param {string} relative
 * @returns {string}
 */
export function read(root, relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

/**
 * @param {string} root
 * @param {string} relative
 * @returns {any}
 */
export function readJson(root, relative) {
  return JSON.parse(read(root, relative));
}

/**
 * Runs `pano-plugin <args>` in `cwd` and returns its output.
 *
 * @param {string} cwd
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 * @returns {{ code: number, stdout: string, stderr: string }}
 */
export function cli(cwd, args, env = {}) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, PANO_SDK_DIR: sdkDir, ...env },
    timeout: 120000,
  });

  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Names of the files below the package folder, sorted.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function packageFiles(root) {
  const base = path.join(root, PACKAGE);
  /** @type {string[]} */
  const found = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) visit(full);
      else found.push(path.relative(base, full).split(path.sep).join('/'));
    }
  };

  if (fs.existsSync(base)) visit(base);

  return found.sort();
}

/** A second view that calls a controller (stamping, controller usage). */
export const GREETER_CARD = `<script>
  import { plugin } from '@panomc/sdk/controllers';

  const greeter = plugin('min').require('greeter');
</script>

<div class="card">{greeter.get().greeting}</div>
`;
