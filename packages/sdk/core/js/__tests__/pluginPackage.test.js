import { afterEach, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import {
  UI_OWNED_ENTRIES,
  readPluginPackage,
  removePluginUiFiles,
  replacePluginUiFiles,
} from "../pluginFolder.util.js";
import { GET, resolveUiFile } from "../../../../theme-core/src/routes/plugins-ui-file.js";

const roots = [];
function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-package-"));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

describe("package entries", () => {
  test("UI_OWNED_ENTRIES lists the package entries", () => {
    for (const e of ["client", "server", "manifest.json", "contract", "pano-plugin.json", "controllers", "samples"]) {
      expect(UI_OWNED_ENTRIES).toContain(e);
    }
  });

  test("replace and remove handle package entries and keep plugin data", () => {
    const root = tmp();
    const staging = path.join(root, "staging");
    const folder = path.join(root, "plugin");
    fs.mkdirSync(path.join(staging, "contract"), { recursive: true });
    fs.writeFileSync(path.join(staging, "contract", "a.json"), "{}");
    fs.writeFileSync(path.join(staging, "pano-plugin.json"), '{"namespace":"x"}');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, "config.conf"), "keep");
    replacePluginUiFiles(staging, folder);
    expect(fs.existsSync(path.join(folder, "contract", "a.json"))).toBe(true);
    removePluginUiFiles(folder);
    expect(fs.existsSync(path.join(folder, "contract"))).toBe(false);
    expect(fs.existsSync(path.join(folder, "pano-plugin.json"))).toBe(false);
    expect(fs.readFileSync(path.join(folder, "config.conf"), "utf8")).toBe("keep");
  });
});

describe("readPluginPackage", () => {
  test("folder without pano-plugin.json is an old plugin", () => {
    expect(readPluginPackage(tmp())).toBeNull();
  });

  test("folder with pano-plugin.json gives namespace, styles, views", () => {
    const dir = tmp();
    fs.writeFileSync(
      path.join(dir, "pano-plugin.json"),
      JSON.stringify({ namespace: "market", styles: ["a.css"], views: { "market:Card": { contract: 1 } } }),
    );
    const pkg = readPluginPackage(dir);
    expect(pkg.namespace).toBe("market");
    expect(pkg.styles).toEqual(["a.css"]);
    expect(Object.keys(pkg.views)).toEqual(["market:Card"]);
  });

  test("broken or non-object json counts as no package", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "pano-plugin.json"), "{nope");
    expect(readPluginPackage(dir)).toBeNull();
    fs.writeFileSync(path.join(dir, "pano-plugin.json"), "[]");
    expect(readPluginPackage(dir)).toBeNull();
  });
});

describe("plugins-ui-file route", () => {
  function setup() {
    const root = tmp();
    fs.mkdirSync(path.join(root, "p1", "contract"), { recursive: true });
    fs.mkdirSync(path.join(root, "p1", "contract-evil"), { recursive: true });
    fs.mkdirSync(path.join(root, "p1", "client"), { recursive: true });
    fs.writeFileSync(path.join(root, "p1", "contract", "V.svelte"), "<p/>");
    fs.writeFileSync(path.join(root, "p1", "contract-evil", "s.txt"), "secret");
    fs.writeFileSync(path.join(root, "p1", "client", "client.mjs"), "x");
    return root;
  }

  test("resolves a file inside the kind", () => {
    const root = setup();
    const r = resolveUiFile("p1", "contract", "V.svelte", root);
    expect(r.filePath).toBe(path.join(path.resolve(root), "p1", "contract", "V.svelte"));
  });

  test("traversal is refused", () => {
    const root = setup();
    expect(resolveUiFile("p1", "contract", "../client/client.mjs", root).status).toBe(403);
    expect(resolveUiFile("p1", "contract", "../contract-evil/s.txt", root).status).toBe(403);
    expect(resolveUiFile("p1", "contract", "..\\x", root).status).toBe(403);
    expect(resolveUiFile("..", "contract", "x", root).status).toBe(403);
    expect(resolveUiFile("p1/../p2", "contract", "x", root).status).toBe(403);
  });

  test("unknown kind and client are 404", () => {
    const root = setup();
    expect(resolveUiFile("p1", "client", "client.mjs", root).status).toBe(404);
    expect(resolveUiFile("p1", "server", "x", root).status).toBe(404);
    expect(resolveUiFile("p1", "nope", "x", root).status).toBe(404);
  });

  test("GET serves with ETag and 304, 404 when missing", async () => {
    const root = setup();
    const cwd = process.cwd();
    fs.mkdirSync(path.join(root, "plugins"));
    fs.renameSync(path.join(root, "p1"), path.join(root, "plugins", "p1"));
    process.chdir(root);
    try {
      const mk = (inm) => ({
        params: { pluginId: "p1", kind: "contract", file: "V.svelte" },
        request: new Request("http://x/", { headers: inm ? { "if-none-match": inm } : {} }),
      });
      const res = await GET(mk());
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/plain");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      const etag = res.headers.get("etag");
      expect(etag).toBeTruthy();
      expect((await GET(mk(etag))).status).toBe(304);
      const missing = await GET({ params: { pluginId: "p1", kind: "contract", file: "nope.js" }, request: new Request("http://x/") });
      expect(missing.status).toBe(404);
      const bad = await GET({ params: { pluginId: "p1", kind: "contract", file: "../client/client.mjs" }, request: new Request("http://x/") });
      expect(bad.status).toBe(403);
    } finally {
      process.chdir(cwd);
    }
  });
});
