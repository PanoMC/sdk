import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const kitDir = path.resolve(here, '../../..');
export const themeCore = path.resolve(kitDir, '../..');
export const sdkDir = path.join(themeCore, 'packages/sdk');
export const bin = path.join(kitDir, 'bin/pano-plugin.js');
export const PACKAGE = 'src/main/resources/plugin-ui';

/** @type {string[]} */
const created = [];

export function cleanup() {
  for (const folder of created.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
}

/**
 * A throw-away `plugins` folder to run `new` in.
 *
 * @returns {string}
 */
export function makePluginsDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pano-kit-new-'));
  const plugins = path.join(root, 'plugins');

  fs.mkdirSync(plugins);
  created.push(root);

  return plugins;
}

/**
 * Output collector for `runNew`.
 *
 * @returns {{ out: (line: string) => void, err: (line: string) => void, stdout: () => string, stderr: () => string }}
 */
export function capture() {
  /** @type {string[]} */
  const stdout = [];
  /** @type {string[]} */
  const stderr = [];

  return {
    out: (line) => stdout.push(line),
    err: (line) => stderr.push(line),
    stdout: () => stdout.join('\n'),
    stderr: () => stderr.join('\n'),
  };
}

/**
 * Relative names of every file below `dir`, sorted.
 *
 * @param {string} dir
 * @returns {string[]}
 */
export function filesBelow(dir) {
  /** @type {string[]} */
  const found = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);

      if (entry.isDirectory()) visit(full);
      else found.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  };

  visit(dir);

  return found.sort();
}
