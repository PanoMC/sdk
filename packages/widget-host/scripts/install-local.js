#!/usr/bin/env node
// Unpacks `dist/widget-runtime.zip` to `<pano dir>/widget-runtime/`, the folder Pano reads the widget runtime from before it falls
// back to the classpath `UIFiles/widget-runtime.zip` (doc 06 section 3.3). Nothing is downloaded, nothing is released.
// Usage: node scripts/install-local.js <pano dir> [--zip <file>]
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip } from './zip.js';

const root = fileURLToPath(new URL('..', import.meta.url));

/**
 * @param {string} panoDir the folder that holds `themes/` (and gets `widget-runtime/`)
 * @param {string} [zipFile]
 * @returns {{ target: string, files: number }}
 */
export function installLocal(panoDir, zipFile = join(root, 'dist/widget-runtime.zip')) {
  if (!panoDir) throw new Error('usage: install-local.js <pano dir> [--zip <file>]');
  const pano = resolve(panoDir);
  if (!existsSync(pano) || !statSync(pano).isDirectory()) throw new Error(`${pano} is not a directory`);
  if (!existsSync(zipFile)) throw new Error(`${zipFile} does not exist: run \`bun run build\` in packages/widget-host first`);

  const entries = readZip(readFileSync(zipFile));
  if (!entries.some((e) => e.name === 'loader.js')) throw new Error(`${zipFile} is not a widget runtime (no loader.js)`);

  const target = join(pano, 'widget-runtime');
  const staging = join(pano, `.widget-runtime-${process.pid}`);
  rmSync(staging, { recursive: true, force: true });

  try {
    for (const { name, data } of entries) {
      const file = resolve(staging, name);
      if (name.startsWith('/') || !file.startsWith(staging + sep)) throw new Error(`${name}: path leaves the target folder`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, data);
    }
    rmSync(target, { recursive: true, force: true });
    renameSync(staging, target);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return { target, files: entries.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const zipAt = args.indexOf('--zip');
  const zip = zipAt >= 0 ? resolve(args.splice(zipAt, 2)[1]) : undefined;
  try {
    const { target, files } = installLocal(args[0], zip);
    console.log(`installed ${files} files to ${target}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
