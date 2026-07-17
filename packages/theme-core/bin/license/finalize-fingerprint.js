#!/usr/bin/env node
/**
 * Post-build step for Pano themes — runs AFTER `vite build` has fully finished.
 *
 * Computes the stable cumulative SHA-256 of every file in `build/` (except manifest.json)
 * and stamps it into `build/manifest.json` as the `fileFingerprint` field. The Pano host
 * re-runs the same hash on install + every theme start, refusing premium themes whose
 * extracted folder doesn't match.
 *
 * Why this is a separate node script and not a vite plugin:
 *   SvelteKit's adapter-node makes vite emit the SSR bundle and the client bundle in two
 *   passes. A vite plugin's `closeBundle` hook fires after EACH pass, so if it runs after
 *   the first pass the second pass's files aren't on disk yet and the digest is taken on
 *   an incomplete tree. Running the hash from package.json's `build` script (after
 *   `vite build` returns) guarantees both passes are done.
 *
 * Triggered by `package.json` scripts:
 *   "build": "vite build && node scripts/license/finalize-fingerprint.js"
 */
import fs from "node:fs";
import path from "node:path";
import { computeStableFileFingerprint } from "./file-fingerprint.js";
import { collectLicenses } from "../generate-licenses.js";

const ROOT = process.cwd();
const BUILD_DIR = path.join(ROOT, "build");
const MANIFEST_FILE = path.join(BUILD_DIR, "manifest.json");

if (!fs.existsSync(BUILD_DIR) || !fs.statSync(BUILD_DIR).isDirectory()) {
  console.error(`[pano-fingerprint] build/ not found at ${BUILD_DIR}. Did vite build succeed?`);
  process.exit(1);
}
if (!fs.existsSync(MANIFEST_FILE)) {
  console.error(`[pano-fingerprint] build/manifest.json missing. The copyManifestPlugin in vite.config.js must run first.`);
  process.exit(1);
}

// licenses.json must exist BEFORE the fingerprint is computed (it is covered by
// it). Generated here, not in a vite plugin: a closeBundle hook races
// adapter-node's final build/ rewrite and the file intermittently vanishes.
if (!fs.existsSync(path.join(BUILD_DIR, "licenses.json"))) {
  collectLicenses(BUILD_DIR);
}

const fingerprint = computeStableFileFingerprint(BUILD_DIR, ["manifest.json"]);

const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf-8"));
manifest.fileFingerprint = fingerprint;
fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + "\n");

console.log(
  `[pano-fingerprint] manifest.fileFingerprint = ${fingerprint.slice(0, 16)}… (over ${
    countFiles(BUILD_DIR, ["manifest.json"])
  } files)`
);

function countFiles(dir, exclude) {
  let n = 0;
  const excludeSet = new Set(exclude);
  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const rel = path.relative(dir, full).split(path.sep).join("/");
        if (!excludeSet.has(rel)) n++;
      }
    }
  }
  walk(dir);
  return n;
}
