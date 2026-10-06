import { afterEach, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { removePluginUiFiles, replacePluginUiFiles } from "../pluginFolder.util.js";

const roots = [];
function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-folder-"));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

function seed(folder, tag) {
  fs.mkdirSync(path.join(folder, "client"), { recursive: true });
  fs.mkdirSync(path.join(folder, "server"), { recursive: true });
  fs.writeFileSync(path.join(folder, "client", "a.js"), tag);
  fs.writeFileSync(path.join(folder, "server", "a.js"), tag);
  fs.writeFileSync(path.join(folder, "manifest.json"), tag);
}

describe("plugin folder sync", () => {
  test("replace keeps foreign files and swaps UI folders", () => {
    const root = tmp();
    const folder = path.join(root, "plugin");
    seed(folder, "old");
    fs.writeFileSync(path.join(folder, "config.conf"), "cfg");
    fs.writeFileSync(path.join(folder, "secret.key"), "key");
    fs.writeFileSync(path.join(folder, "client", "stale.js"), "x");
    const staging = path.join(root, ".staging");
    seed(staging, "new");

    replacePluginUiFiles(staging, folder);

    expect(fs.readFileSync(path.join(folder, "config.conf"), "utf8")).toBe("cfg");
    expect(fs.readFileSync(path.join(folder, "secret.key"), "utf8")).toBe("key");
    expect(fs.readFileSync(path.join(folder, "client", "a.js"), "utf8")).toBe("new");
    expect(fs.existsSync(path.join(folder, "client", "stale.js"))).toBe(false);
    expect(fs.existsSync(staging)).toBe(false);
  });

  test("replace works when the folder only holds plugin data", () => {
    const root = tmp();
    const folder = path.join(root, "plugin");
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, "secret.key"), "key");
    const staging = path.join(root, ".staging");
    seed(staging, "new");

    replacePluginUiFiles(staging, folder);

    expect(fs.readFileSync(path.join(folder, "secret.key"), "utf8")).toBe("key");
    expect(fs.existsSync(path.join(folder, "server", "a.js"))).toBe(true);
  });

  test("remove keeps foreign files; deletes the folder when nothing else is left", () => {
    const root = tmp();
    const folder = path.join(root, "plugin");
    seed(folder, "old");
    fs.writeFileSync(path.join(folder, "config.conf"), "cfg");
    removePluginUiFiles(folder);
    expect(fs.readdirSync(folder)).toEqual(["config.conf"]);

    const empty = path.join(root, "plain");
    seed(empty, "old");
    removePluginUiFiles(empty);
    expect(fs.existsSync(empty)).toBe(false);
  });
});
