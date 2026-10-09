// Shared test helpers for the theme-core check rules: a minimal valid theme in a temp folder, a runner.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll } from "bun:test";
import { runChecks } from "../../check.js";

export const pkgDir = join(import.meta.dir, "..", "..", "..");
export const fixturesDir = join(import.meta.dir, "fixtures");
export const corePkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf-8"));
export const engineView = (name) => readFileSync(join(pkgDir, "src", "lib", "views", `${name}.svelte`), "utf-8");

const roots = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

export const CONFIG_EMPTY = "export default { views: {} };\n";

/**
 * A valid theme: package.json (svelte pinned), manifest.json, theme.config.js, and `files`
 * (relative path -> text). `snapshot: true` copies the `market` plugin snapshot into plugin-contracts/.
 * @param {{ config?: string, files?: Record<string, string>, snapshot?: boolean }} [options]
 */
export function makeTheme({ config = CONFIG_EMPTY, files = {}, snapshot = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "theme-core-check-"));
  roots.push(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "pano-fixture-theme", dependencies: { svelte: corePkg.dependencies.svelte } }));
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({ id: "fixture-theme", title: "Fixture", version: "1.0.0", author: "x", panoVersion: "1.0.0", screenshots: [] }),
  );
  writeFileSync(join(dir, "theme.config.js"), config);
  if (snapshot) cpSync(join(fixturesDir, "plugin-contracts"), join(dir, "plugin-contracts"), { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

/** Runs every rule in-process; API paths are checked against the fixture routes file. */
export function check(dir, options = {}) {
  return runChecks({
    themeDir: dir,
    ...options,
    env: { ...process.env, PANO_CHECK_ROUTES: join(fixturesDir, "routes.json") },
  });
}

/** Messages of one level, optionally of one rule. */
export const at = (report, level, rule) =>
  report.findings.filter((f) => f.level === level && (rule === undefined || f.rule === rule)).map((f) => f.message);

export const read = (dir, path) => readFileSync(join(dir, path), "utf-8");
