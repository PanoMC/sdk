#!/usr/bin/env node
// Packs `dist/runtime/` into `dist/widget-runtime.zip` (doc 06 section 3.3). The zip root is the runtime folder itself
// (`loader.js`, `svelte/`, `host/`, `css/`, ...), which is what Pano serves from `widget-runtime/` or `UIFiles/widget-runtime.zip`.
// Usage: node scripts/build-zip.js        (run `rollup -c` first; `bun run build` does both)
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeZip } from './zip.js';

const root = fileURLToPath(new URL('..', import.meta.url));
export const RUNTIME_DIR = join(root, 'dist/runtime');
export const ZIP_FILE = join(root, 'dist/widget-runtime.zip');

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

export function buildZip(runtimeDir = RUNTIME_DIR, zipFile = ZIP_FILE) {
  let files;
  try {
    files = walk(runtimeDir);
  } catch {
    throw new Error(`${runtimeDir} does not exist: run \`bun run build\` in packages/widget-host first`);
  }
  if (!files.some((f) => f.endsWith('loader.js'))) throw new Error(`${runtimeDir} has no loader.js: the runtime build did not finish`);

  const entries = files.map((f) => ({ name: relative(runtimeDir, f).split('\\').join('/'), data: readFileSync(f) }));
  mkdirSync(join(zipFile, '..'), { recursive: true });
  writeFileSync(zipFile, writeZip(entries));
  return { zipFile, files: entries.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { zipFile, files } = buildZip();
  console.log(`wrote ${zipFile} (${files} files)`);
}
