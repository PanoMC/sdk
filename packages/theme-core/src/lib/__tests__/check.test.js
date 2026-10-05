import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pkgDir = join(import.meta.dir, "..", "..", "..");
const checkJs = join(pkgDir, "bin", "check.js");
const corePkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf-8"));
const defaultView = join(pkgDir, "src", "lib", "views", "MainLayoutView.svelte");

const roots = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A minimal valid theme whose only override is MainLayoutView (a copy of the default, plus `extra`). */
function makeTheme({ extraHead = "", registerOverride = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "theme-core-check-"));
  roots.push(dir);

  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "pano-fixture-theme", dependencies: { svelte: corePkg.dependencies.svelte } }),
  );
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      id: "fixture-theme",
      title: "Fixture",
      version: "1.0.0",
      author: "x",
      panoVersion: "1.0.0",
      screenshots: [],
    }),
  );
  writeFileSync(
    join(dir, "theme.config.js"),
    registerOverride
      ? `export default { views: { MainLayoutView: () => import("./src/views/MainLayoutView.svelte") } };\n`
      : `export default { views: {} };\n`,
  );

  mkdirSync(join(dir, "src", "views"), { recursive: true });
  const view = join(dir, "src", "views", "MainLayoutView.svelte");
  cpSync(defaultView, view);
  if (extraHead) {
    const source = readFileSync(view, "utf-8").replace("<svelte:head>", `<svelte:head>\n  ${extraHead}`);
    writeFileSync(view, source);
  }

  return dir;
}

function runCheck(cwd) {
  const proc = Bun.spawnSync([process.execPath, checkJs], { cwd, stdout: "pipe", stderr: "pipe" });

  return {
    code: proc.exitCode,
    out: proc.stdout.toString() + proc.stderr.toString(),
  };
}

describe("bin/check.js MainLayoutView description (TC-8)", () => {
  test("the default MainLayoutView no longer emits a description tag", () => {
    expect(readFileSync(defaultView, "utf-8")).not.toMatch(/name\s*=\s*["']description["']/);
  });

  test("control: an override that is a copy of the default passes", () => {
    const { code, out } = runCheck(makeTheme());

    expect(out).toContain("OK");
    expect(code).toBe(0);
  });

  test("an override that still contains name=\"description\" fails", () => {
    const { code, out } = runCheck(
      makeTheme({ extraHead: '<meta content={$session.siteInfo.websiteDescription} name="description" />' }),
    );

    expect(code).not.toBe(0);
    expect(out).toContain("MainLayoutView");
    expect(out).toContain("description");
  });

  test("single-quoted attribute and attribute-first order also fail", () => {
    for (const tag of [
      "<meta name='description' content=\"x\" />",
      '<meta name="description" content="x" />',
      '<meta name = "description" content="x">',
    ]) {
      expect(runCheck(makeTheme({ extraHead: tag })).code).not.toBe(0);
    }
  });

  test("a commented-out description tag and other meta names do not fail", () => {
    expect(runCheck(makeTheme({ extraHead: '<!-- <meta name="description" content="x" /> -->' })).code).toBe(0);
    expect(runCheck(makeTheme({ extraHead: '<meta name="author" content="x" />' })).code).toBe(0);
  });

  test("an unregistered override file is not checked", () => {
    const dir = makeTheme({
      extraHead: '<meta name="description" content="x" />',
      registerOverride: false,
    });

    expect(runCheck(dir).code).toBe(0);
  });
});
