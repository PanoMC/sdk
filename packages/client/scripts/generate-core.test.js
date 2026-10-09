import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { panoClientGen } from "../../plugin-kit/src/rollup/client-gen.js";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "generate-core.js");
const mini = resolve(here, "../../client-gen/src/golden/mini");

test("generate-core.js is deterministic: a run over the committed snapshot changes no file", () => {
  const core = join(here, "../src/core");
  const read = () => Object.fromEntries(readdirSync(core).sort().map((f) => [f, readFileSync(join(core, f), "utf8")]));
  const before = read();
  expect(Object.keys(before)).toEqual(["index.js", "openapi.json", "operations.js", "types.js"]);
  execFileSync("node", [script, join(core, "openapi.json")]);
  expect(read()).toEqual(before);
  expect(before["types.js"].trimEnd().endsWith("export {};")).toBe(true);
});

test("the panoClientGen hook writes client/ from api/openapi.json and keeps an existing package.json", async () => {
  const root = mkdtempSync(join(tmpdir(), "client-hook-"));
  try {
    // no snapshot: nothing written
    await panoClientGen({ pluginId: "pano-plugin-demo", namespace: "demo", root }).buildStart.call({ warn() {} });
    expect(existsSync(join(root, "client"))).toBe(false);

    mkdirSync(join(root, "api"));
    cpSync(join(mini, "openapi.json"), join(root, "api/openapi.json"));
    await panoClientGen({ pluginId: "pano-plugin-demo", namespace: "demo", root }).buildStart.call({ warn() {} });
    expect(readFileSync(join(root, "client/index.js"), "utf8")).toBe(readFileSync(join(mini, "index.js"), "utf8"));
    const pkg = JSON.parse(readFileSync(join(root, "client/package.json"), "utf8"));
    expect(pkg.name).toBe("pano-client-demo");

    writeFileSync(join(root, "client/package.json"), '{"name":"@panomc/client-demo"}\n');
    await panoClientGen({ pluginId: "pano-plugin-demo", namespace: "demo", root }).buildStart.call({ warn() {} });
    expect(readFileSync(join(root, "client/package.json"), "utf8")).toBe('{"name":"@panomc/client-demo"}\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
