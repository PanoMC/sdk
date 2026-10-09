// Shared test helpers: fixture copies in a temp dir and directory snapshots.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.join(HERE, 'fixtures');
export const CLI = path.join(HERE, '..', '..', 'pano-api.js');
const made = [];

/** Copies a fixture folder into a fresh temp dir. @param {string} name */
export function copyFixture(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pano-api-test-'));
  made.push(dir);
  fs.cpSync(path.join(FIXTURES, name), dir, { recursive: true });
  return dir;
}

export function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pano-api-test-'));
  made.push(dir);
  return dir;
}

export function cleanup() {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
}

/** @param {string} dir @returns {Record<string, string>} relative path -> content */
export function snapshot(dir) {
  const out = {};
  const visit = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) visit(full);
      else out[path.relative(dir, full).split(path.sep).join('/')] = fs.readFileSync(full, 'utf8');
    }
  };
  visit(dir);
  return out;
}

/** Runs the CLI in-process-free (child process) and returns { code, stdout, stderr }. */
export function runCli(args, cwd) {
  const r = Bun.spawnSync(['node', CLI, ...args], { cwd: cwd || HERE });
  return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}
