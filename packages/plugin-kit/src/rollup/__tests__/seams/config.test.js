import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, namespaceOf } from "../../../config.js";

const dirs = [];

function plugin(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kit-config-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

afterEach(() => {
  delete process.env.PANO_SDK_DIR;
  while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true });
});

describe("namespaceOf", () => {
  test("strips a leading pano-plugin- and nothing else", () => {
    expect(namespaceOf("pano-plugin-market")).toBe("market");
    expect(namespaceOf("pano-plugin-market-payments")).toBe("market-payments");
    expect(namespaceOf("acme-shop")).toBe("acme-shop");
    expect(namespaceOf("my-pano-plugin-x")).toBe("my-pano-plugin-x");
  });

  test("config.namespace wins", () => {
    expect(namespaceOf("pano-plugin-market", { namespace: "shop" })).toBe("shop");
  });

  test("reserved and malformed namespaces are refused with the fix", () => {
    expect(() => namespaceOf("pano-plugin-core")).toThrow(/reserved.*pano\.plugin\.js/);
    expect(() => namespaceOf("pano-plugin-x", { namespace: "Bad:Name" })).toThrow(/invalid/);
    expect(() => namespaceOf("")).toThrow(/pluginId is required/);
  });
});

describe("loadConfig", () => {
  test("defaults: id from gradle.properties, one view dir, no styles", async () => {
    const dir = plugin({
      "gradle.properties": "# comment\npluginName=Shop\npluginId=pano-plugin-shop\n",
    });
    expect(await loadConfig(dir)).toEqual({
      pluginId: "pano-plugin-shop",
      namespace: "shop",
      viewDirs: ["src/theme/views"],
      styles: {},
      sdkDir: null,
    });
  });

  test("pano.plugin.js overrides namespace, viewDirs and styles; PANO_SDK_DIR resolves", async () => {
    const dir = plugin({
      "gradle.properties": "pluginId = pano-plugin-market\n",
      "pano.plugin.js":
        'export default { namespace: "store", viewDirs: ["src/theme/pages/", "src/theme/components"], styles: { safelist: ["fa-x"] } };\n',
    });
    process.env.PANO_SDK_DIR = "../sdk";
    const config = await loadConfig(dir);
    expect(config.namespace).toBe("store");
    expect(config.viewDirs).toEqual(["src/theme/pages", "src/theme/components"]);
    expect(config.styles).toEqual({ safelist: ["fa-x"] });
    expect(config.sdkDir).toBe(path.resolve(dir, "../sdk"));
  });

  test("missing pluginId and bad viewDirs name the fix", async () => {
    await expect(loadConfig(plugin({}))).rejects.toThrow(/pluginId=pano-plugin-/);
    const dir = plugin({
      "gradle.properties": "pluginId=pano-plugin-a\n",
      "pano.plugin.js": "export default { viewDirs: [] };\n",
    });
    await expect(loadConfig(dir)).rejects.toThrow(/viewDirs/);
  });
});
