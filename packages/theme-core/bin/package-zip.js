#!/usr/bin/env bun
/**
 * theme-core package — deterministic zip of build/.
 *
 * The whole-zip sha256 IS the premium license identity on panomc.com, and
 * bot-driven rebuilds must not churn license claims — so the zip must be
 * byte-reproducible: fixed mtimes, stable entry order, no extra fields.
 * (The build itself is reproducible because the core svelte-config factory
 * pins kit.version.name; see docs/P0-SPIKE.md.)
 *
 * Usage: theme-core package [outfile.zip]   (default: <id>-<version>.zip)
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, utimesSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = process.cwd();

const BUILD = join(ROOT, "build");

if (!existsSync(join(BUILD, "manifest.json"))) {
  console.error("[theme-core] build/manifest.json missing — run `bun run build` first");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(BUILD, "manifest.json"), "utf-8"));
const out = resolve(ROOT, process.argv[2] ?? `${manifest.id}-${manifest.version}.zip`);

// Fixed mtime: any constant works; changing it changes every future zip hash,
// so treat it as frozen.
const EPOCH = new Date("2026-01-01T00:00:00Z");
// Safety: never let repo internals or a previous zip leak into the artifact.
const EXCLUDE = new Set([".git", ".gitignore", ".claude", "node_modules", ".DS_Store"]);

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir).sort()) {
    if (EXCLUDE.has(entry) || entry.endsWith(".zip")) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else {
      utimesSync(p, EPOCH, EPOCH);
      files.push(p.slice(BUILD.length + 1));
    }
  }
})(BUILD);

if (existsSync(out)) rmSync(out);
execFileSync("zip", ["-X", "-q", out, "-@"], {
  cwd: BUILD,
  input: files.join("\n"),
  env: { ...process.env, TZ: "UTC" },
});

const hash = execFileSync("sha256sum", [out]).toString().split(" ")[0];
console.log(`[theme-core] ${out}`);
console.log(`[theme-core] ${files.length} entries, sha256 ${hash} (this hash is the premium license identity)`);
