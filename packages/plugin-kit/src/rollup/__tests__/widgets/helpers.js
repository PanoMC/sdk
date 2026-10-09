import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rollup } from 'rollup';
import { panoPlugin } from '../../index.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export const themeCore = path.resolve(here, '../../../../../..');
export const fixture = path.join(themeCore, 'test-fixtures/plugin-widgets');
export const pluginMin = path.join(themeCore, 'test-fixtures/plugin-min');
export const sdkDir = path.join(themeCore, 'packages/sdk');

/** @type {string[]} */
const made = [];

export function tempDir(prefix = 'pano-widgets-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));

  made.push(dir);

  return dir;
}

export function cleanup() {
  while (made.length) fs.rmSync(made.pop(), { recursive: true, force: true });
}

/** Copies the fixture plugin (without built output) into a temp folder and applies `files` (path -> content, null = delete). */
export function copyFixture(files = {}) {
  const root = tempDir('pano-widgets-plugin-');

  fs.cpSync(fixture, root, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}src${path.sep}main${path.sep}resources`),
  });

  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file);

    if (content === null) fs.rmSync(target, { force: true });
    else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
  }

  return root;
}

export const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');

/** Every file under `dir` by relative path (empty when the folder does not exist). */
export function filesOf(dir) {
  /** @type {Record<string, string>} */
  const files = {};

  if (!fs.existsSync(dir)) return files;

  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);

      if (entry.isDirectory()) walk(file);
      else files[path.relative(dir, file).replace(/\\/g, '/')] = fs.readFileSync(file, 'utf8');
    }
  };

  walk(dir);

  return files;
}

/** Runs one `panoPlugin()` side to disk. @param {import('rollup').RollupOptions[]} configs */
export async function write(configs) {
  for (const config of configs) {
    const bundle = await rollup(config);

    await bundle.write(/** @type {any} */ (config.output));
    await bundle.close();
  }
}

/** The configs of `panoPlugin()` for given sides, without the clean-up plugin (it would empty the folder again). */
export async function sides(root, outDir, names, options = {}) {
  const configs = [];

  for (const side of names) {
    const [config] = await panoPlugin({ root, outDir, side, minify: false, ...options });

    config.plugins = (config.plugins ?? []).filter((plugin) => plugin && plugin.name !== 'delete');
    configs.push(config);
  }

  return configs;
}

/** Builds the widgets side and returns the written files of `widgets/`. */
export async function buildWidgets(root, options = {}) {
  const out = tempDir('pano-widgets-out-');

  await write(await sides(root, out, ['widgets'], options));

  return { out, files: filesOf(path.join(out, 'widgets')) };
}

/** The message of the error a build throws, without the rollup plugin prefix. */
export async function buildError(root, options = {}) {
  try {
    await buildWidgets(root, options);
  } catch (error) {
    return String(error.message).replace(/^\[plugin pano-widgets\] /, '');
  }

  throw new Error('expected the widgets build to fail');
}
