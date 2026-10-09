import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const binDir = resolve(import.meta.dir, "..", "..");
const cli = join(binDir, "theme-core.js");
const sdkDir = resolve(binDir, "..", "..", "sdk");
const roots = [];

afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temp() {
  const dir = mkdtempSync(join(tmpdir(), "cx02-"));
  roots.push(dir);
  return dir;
}

function run(cwd, args) {
  const r = spawnSync("bun", [cli, ...args], { cwd, encoding: "utf8", timeout: 120000 });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe("theme-core new --local", () => {
  const cwd = temp();
  const made = run(cwd, ["new", "my-theme", "--local"]);
  const pkg = () => JSON.parse(readFileSync(join(cwd, "my-theme", "package.json"), "utf8"));

  test("scaffolds", () => {
    expect(made.stderr).toBe("");
    expect(made.code).toBe(0);
  });

  test("package.json overrides @panomc/sdk with the local sdk, so the first bun install resolves", () => {
    expect(pkg().overrides).toEqual({ "@panomc/sdk": `file:${sdkDir}` });
    expect(pkg().devDependencies["@panomc/sdk"]).toBe(`file:${sdkDir}`);
  });

  test("bunfig.toml selects the hoisted linker (the isolated one copies a file: package on the second install)", () => {
    expect(readFileSync(join(cwd, "my-theme", "bunfig.toml"), "utf8")).toContain('linker = "hoisted"');
  });

  test("dev:ui prints the hint first, then starts the watchers", () => {
    const script = pkg().scripts["dev:ui"];

    expect(script).toContain("theme-core.js dev-hint");
    expect(script.indexOf("dev-hint")).toBeLessThan(script.indexOf("concurrently"));
  });
});

describe("theme-core dev-hint", () => {
  test("names the panel field and Development Mode, with the dev server URL", () => {
    const result = run(temp(), ["dev-hint", "--port", "3007"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Panel → Appearance → Front-end → Theme dev server");
    expect(result.stdout).toContain("http://localhost:3007");
    expect(result.stdout).toContain("Development Mode");
    expect(result.stdout.trim().split("\n")).toHaveLength(2);
  });

  test("the port defaults to 3000 and the command is listed in help", () => {
    expect(run(temp(), ["dev-hint"]).stdout).toContain("http://localhost:3000");
    expect(run(temp(), ["help"]).stdout).toContain("dev-hint");
  });
});

describe("sync resolves FontAwesome from the engine when the theme does not list it", () => {
  test("pano-fallback-icons.css and the webfonts are written", () => {
    const dir = temp();

    writeFileSync(join(dir, "package.json"), '{"name":"bare-theme","type":"module"}\n');
    mkdirSync(join(dir, "src"), { recursive: true });

    const r = spawnSync("bun", [join(binDir, "sync.js")], { cwd: dir, encoding: "utf8", timeout: 120000 });

    expect(r.status).toBe(0);
    expect(existsSync(join(dir, "static", "assets", "css", "pano-fallback-icons.css"))).toBe(true);
    expect(existsSync(join(dir, "static", "assets", "webfonts", "fa-solid-900.woff2"))).toBe(true);
  });
});
