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

function runCheck(cwd, args = []) {
  const proc = Bun.spawnSync([process.execPath, checkJs, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, PANO_CHECK_ROUTES: join(pkgDir, "bin", "__tests__", "check", "fixtures", "routes.json") },
  });

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

describe("bin/check.js arguments (TC-41)", () => {
  /** A theme with one warning (a plugin view without a snapshot) and nothing else. */
  function warningTheme() {
    const dir = makeTheme({ registerOverride: false });
    mkdirSync(join(dir, "src", "views"), { recursive: true });
    writeFileSync(join(dir, "src", "views", "P.svelte"), "<div></div>");
    writeFileSync(
      join(dir, "theme.config.js"),
      `export default { views: { "market:ProductCard": () => import("./src/views/P.svelte") } };\n`,
    );

    return dir;
  }

  test("a warning prints and exits 0; --strict turns it into a failure", () => {
    const dir = warningTheme();
    const lax = runCheck(dir);

    expect(lax.code).toBe(0);
    expect(lax.out).toContain("[C2]");
    expect(lax.out).toContain("run: theme-core contracts pull");
    expect(lax.out).toContain("OK");

    const strict = runCheck(dir, ["--strict"]);

    expect(strict.code).toBe(1);
    expect(strict.out).toContain("[C2]");
    expect(strict.out).toContain("1 problem must be fixed");
    expect(strict.out).toContain("strict");
  });

  test("an unknown argument exits 2 and names the usage", () => {
    const { code, out } = runCheck(makeTheme(), ["--stric"]);

    expect(code).toBe(2);
    expect(out).toContain("--stric");
    expect(out).toContain("theme-core check [--strict] [--fix]");
  });

  test("--fix writes the controller pins; a second run is clean even under --strict", () => {
    const dir = makeTheme({ registerOverride: false });
    cpSync(
      join(pkgDir, "bin", "__tests__", "check", "fixtures", "plugin-contracts"),
      join(dir, "plugin-contracts"),
      { recursive: true },
    );
    mkdirSync(join(dir, "src", "pages"), { recursive: true });
    writeFileSync(
      join(dir, "src", "pages", "Cart.svelte"),
      `<script>\n  import { plugin } from "@panomc/sdk/controllers";\n  const cart = plugin("market").use("cart");\n</script>\n`,
    );

    const before = runCheck(dir);

    expect(before.code).toBe(0);
    expect(before.out).toContain("[C12]");
    expect(before.out).toContain("run: theme-core check --fix");
    expect(runCheck(dir, ["--strict"]).code).toBe(1);

    const fixed = runCheck(dir, ["--strict", "--fix"]);

    expect(fixed.out).toContain("fixed: pinned controller 'market/cart' to version 2");
    expect(fixed.code).toBe(0);
    expect(readFileSync(join(dir, "theme.config.js"), "utf-8")).toContain('"market/cart": 2');
    expect(runCheck(dir, ["--strict"]).code).toBe(0);
  });

  test("info lines (claims) never fail a strict run", () => {
    const dir = makeTheme({ registerOverride: false });
    cpSync(
      join(pkgDir, "bin", "__tests__", "check", "fixtures", "plugin-contracts"),
      join(dir, "plugin-contracts"),
      { recursive: true },
    );
    mkdirSync(join(dir, "src", "views"), { recursive: true });
    writeFileSync(join(dir, "src", "views", "Navbar.svelte"), '<PluginBlock id="market:NavCart" />');
    writeFileSync(
      join(dir, "theme.config.js"),
      `export default { views: { Navbar: () => import("./src/views/Navbar.svelte") } };\n`,
    );

    const { code, out } = runCheck(dir, ["--strict"]);

    expect(out).toContain("automatic copy in 'navbar-right' is suppressed");
    expect(code).toBe(0);
  });
});
