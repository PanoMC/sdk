import { afterAll, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// TC-39: the four text layers through loadLanguage (doc 03 section 5.3) with a stubbed fetch, and
// `theme-core sync` writing lang/<locale>.plugins.json and the engine stylesheets (section 5.1,
// 4.2, 4.6). Also that the bins find hoisted packages in a Bun workspace.

mock.module("$app/paths", () => ({ base: "" }));
mock.module("$app/environment", () => ({ browser: false, dev: false }));

/** What the stubbed translations API answers; each test sets it. */
let apiAnswer = { result: "ok", data: {}, meta: {} };

mock.module("$pano/lib/api.util.js", () => ({
  default: {
    get: async ({ path }) => {
      if (path === "/api/locales") return { result: "ok", data: [{ code: "tr", name: "Turkce" }] };
      return apiAnswer;
    },
  },
}));

// a fresh instance, so the api stub above is the one it is bound to
const { loadLanguage } = await import("../language.util.js?layers");
const { _, locale } = await import("svelte-i18n");
const { get } = await import("svelte/store");

const KEY = "plugins.pano-plugin-market.theme.store.title";
const tree = (value) => ({ theme: { store: { title: value } } });

const json = (body, status = 200) => ({ ok: status === 200, status, json: async () => body });

/** event.fetch answering the two theme-api files; `plugins: null` = the third file is a 404 */
function eventFor({ theme = {}, plugins = null } = {}) {
  const urls = [];

  return {
    urls,
    fetch: async (url) => {
      urls.push(String(url));
      if (String(url).endsWith(".plugins.json")) {
        return plugins === null ? json({ error: "Language file not found" }, 404) : json(plugins);
      }
      return json(theme);
    },
  };
}

async function shown(event, key = KEY) {
  await loadLanguage({ code: "tr", name: "Turkce" }, event);
  locale.set("tr");

  return get(_)(key);
}

describe("loadLanguage merges the text layers", () => {
  test("worked example of doc 03 section 5.3", async () => {
    apiAnswer = { result: "ok", data: { plugins: { "pano-plugin-market": tree("Mağaza") } }, meta: {} };
    expect(await shown(eventFor())).toBe("Mağaza");

    expect(await shown(eventFor({ plugins: { market: tree("Dükkan") } }))).toBe("Dükkan");

    apiAnswer = {
      result: "ok",
      data: { plugins: { "pano-plugin-market": tree("Market") } },
      meta: { pluginAdminKeys: { "pano-plugin-market": ["theme.store.title"] } },
    };
    expect(await shown(eventFor({ plugins: { market: tree("Dükkan") } }))).toBe("Market");
  });

  test("fetches the third file in the same call, from the same base", async () => {
    apiAnswer = { result: "ok", data: {}, meta: {} };
    const event = eventFor();
    await shown(event);

    expect(event.urls.sort()).toEqual(["/theme-api/languages/tr.json", "/theme-api/languages/tr.plugins.json"]);
  });

  test("a missing or failing third file is {}: the plugin text and the theme file still show", async () => {
    apiAnswer = { result: "ok", data: { plugins: { "pano-plugin-market": tree("Mağaza") } }, meta: {} };

    expect(await shown(eventFor({ theme: { greeting: "merhaba" }, plugins: null }), "greeting")).toBe("merhaba");
    expect(await shown(eventFor({ plugins: null }))).toBe("Mağaza");

    const broken = {
      fetch: async (url) => {
        if (String(url).endsWith(".plugins.json")) throw new Error("network");
        return json({});
      },
    };
    expect(await shown(broken)).toBe("Mağaza");

    const badBody = {
      fetch: async (url) =>
        String(url).endsWith(".plugins.json") ? { ok: true, status: 200, json: async () => { throw new Error("bad json"); } } : json({}),
    };
    expect(await shown(badBody)).toBe("Mağaza");
  });

  test("the dictionary is flat: a plugin id with a dot resolves, core keys keep working", async () => {
    apiAnswer = {
      result: "ok",
      data: { plugins: { "acme.shop": { theme: { title: "Acme" } } }, custom: { key: "admin value" } },
      meta: {},
    };
    const event = eventFor({ theme: { nav: { home: "Ana sayfa" }, custom: { key: "theme value" } } });

    expect(await shown(event, "plugins.acme.shop.theme.title")).toBe("Acme");
    expect(get(_)("nav.home")).toBe("Ana sayfa");
    expect(get(_)("custom.key")).toBe("admin value");
  });

  test("a failed translations API answer leaves the theme file and the theme's plugin files", async () => {
    apiAnswer = { result: "error" };
    const event = eventFor({ theme: { greeting: "merhaba" }, plugins: { "pano-plugin-market": tree("Dükkan") } });
    await loadLanguage({ code: "tr" }, event);

    expect(get(_)("greeting")).toBe("merhaba");
  });
});

// ---------------------------------------------------------------------------
// sync.js and the bins on fixture themes
// ---------------------------------------------------------------------------

const pkgDir = join(import.meta.dir, "..", "..", "..");
const syncJs = join(pkgDir, "bin", "sync.js");
const bundleJs = join(pkgDir, "bin", "bundle-internal-libs.js");

const roots = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function put(root, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

const sdkStub = (root) =>
  put(root, {
    "node_modules/@panomc/sdk/package.json": JSON.stringify({ name: "@panomc/sdk", version: "0.0.0" }),
    "node_modules/@panomc/sdk/core/css/pano-tokens.css": ":root{--pano-color-primary:#123456}\n",
    "node_modules/@fortawesome/fontawesome-free/package.json": JSON.stringify({ name: "@fortawesome/fontawesome-free", version: "6.0.0" }),
    "node_modules/@fortawesome/fontawesome-free/css/all.min.css": ".fa{}\n",
    "node_modules/@fortawesome/fontawesome-free/webfonts/fa.woff2": "font",
    "node_modules/bootstrap/package.json": JSON.stringify({ name: "bootstrap", version: "5.3.0" }),
    "node_modules/bootstrap/dist/js/bootstrap.bundle.min.js": "/* bootstrap */\n",
  });

function makeTheme(files = {}, { workspace = false } = {}) {
  const base = mkdtempSync(join(tmpdir(), "theme-core-tc39-"));
  roots.push(base);

  const dir = workspace ? join(base, "themes", "fixture") : base;
  mkdirSync(dir, { recursive: true });
  // hoisted: the packages sit at the workspace root, not in the theme's own node_modules
  sdkStub(base);
  put(dir, { "package.json": JSON.stringify({ name: "pano-fixture-theme" }), ...files });

  return dir;
}

function run(script, cwd) {
  const proc = Bun.spawnSync([process.execPath, script], { cwd, stdout: "pipe", stderr: "pipe" });

  return { code: proc.exitCode, out: proc.stdout.toString() + proc.stderr.toString() };
}

const read = (dir, path) => readFileSync(join(dir, path), "utf-8");

describe("sync: lang/<locale>.plugins.json", () => {
  const files = {
    "lang-overrides/tr.json": JSON.stringify({ own: { key: "x" } }),
    "lang-overrides/plugins/market/tr.json": JSON.stringify(tree("Dükkan")),
    "lang-overrides/plugins/market/en-US.json": JSON.stringify(tree("Shop")),
    "lang-overrides/plugins/pano-plugin-wiki/tr.json": JSON.stringify({ title: "Wiki" }),
  };

  test("one file per locale with a plugin file, keyed by folder; lang/<locale>.json stays free of plugin text", () => {
    const dir = makeTheme(files);
    const result = run(syncJs, dir);
    expect(result.code).toBe(0);

    expect(JSON.parse(read(dir, "lang/tr.plugins.json"))).toEqual({
      "pano-plugin-wiki": { title: "Wiki" },
      market: tree("Dükkan"),
    });
    expect(JSON.parse(read(dir, "lang/en-US.plugins.json"))).toEqual({ market: tree("Shop") });
    expect(existsSync(join(dir, "lang", "de.plugins.json"))).toBe(false);

    const own = JSON.parse(read(dir, "lang/tr.json"));
    expect(own.own).toEqual({ key: "x" });
    expect(JSON.stringify(own)).not.toContain("Dükkan");
    // the "plugins" folder is not a locale
    expect(existsSync(join(dir, "lang", "plugins.json"))).toBe(false);
  });

  test("a theme without plugin files writes none, and a removed source removes the stale file", () => {
    const dir = makeTheme({ "lang-overrides/tr.json": "{}" });
    expect(run(syncJs, dir).code).toBe(0);
    expect(readdirSync(join(dir, "lang")).filter((f) => f.endsWith(".plugins.json"))).toEqual([]);

    put(dir, { "lang-overrides/plugins/market/tr.json": JSON.stringify(tree("Dükkan")) });
    expect(run(syncJs, dir).code).toBe(0);
    expect(existsSync(join(dir, "lang", "tr.plugins.json"))).toBe(true);

    rmSync(join(dir, "lang-overrides", "plugins"), { recursive: true });
    expect(run(syncJs, dir).code).toBe(0);
    expect(existsSync(join(dir, "lang", "tr.plugins.json"))).toBe(false);
  });

  test("a plugin file that is not a JSON object stops the sync with the file name", () => {
    const dir = makeTheme({ "lang-overrides/plugins/market/tr.json": "[1]" });
    const result = run(syncJs, dir);

    expect(result.code).not.toBe(0);
    expect(result.out).toContain("lang-overrides/plugins/market/tr.json");
  });
});

describe("sync: engine stylesheets", () => {
  test("pano-tokens.css and the FontAwesome sheet (as pano-fallback-icons.css) are copied, and refreshed when they change", () => {
    const dir = makeTheme();
    expect(run(syncJs, dir).code).toBe(0);

    expect(read(dir, "static/assets/css/pano-tokens.css")).toContain("--pano-color-primary:#123456");
    expect(read(dir, "static/assets/css/pano-fallback-icons.css")).toBe(".fa{}\n");
    expect(existsSync(join(dir, "static/assets/webfonts/fa.woff2"))).toBe(true);

    writeFileSync(join(dir, "node_modules/@panomc/sdk/core/css/pano-tokens.css"), ":root{--pano-color-primary:#abcdef}\n");
    expect(run(syncJs, dir).code).toBe(0);
    expect(read(dir, "static/assets/css/pano-tokens.css")).toContain("#abcdef");
  });

  test("a source that does not exist is skipped without an error", () => {
    const dir = makeTheme();
    rmSync(join(dir, "node_modules"), { recursive: true, force: true });

    expect(run(syncJs, dir).code).toBe(0);
    // the sheets that live in the engine package itself are still copied; the one that comes from the missing sdk is
    // skipped. The icon sheet follows the engine's own FontAwesome dependency (sync falls back to it when the theme has
    // no copy), so it exists exactly when the engine can resolve the package.
    let engineHasFontAwesome = true;
    try {
      createRequire(syncJs).resolve("@fortawesome/fontawesome-free/package.json");
    } catch {
      engineHasFontAwesome = false;
    }

    expect(existsSync(join(dir, "static/assets/css/pano-fallback.css"))).toBe(true);
    expect(existsSync(join(dir, "static/assets/css/pano-tokens.css"))).toBe(false);
    expect(existsSync(join(dir, "static/assets/css/pano-fallback-icons.css"))).toBe(engineHasFontAwesome);
  });
});

describe("bins inside a workspace (hoisted node_modules)", () => {
  test("sync finds the sdk and FontAwesome at the workspace root", () => {
    const dir = makeTheme({}, { workspace: true });
    expect(existsSync(join(dir, "node_modules"))).toBe(false);

    expect(run(syncJs, dir).code).toBe(0);
    expect(existsSync(join(dir, "static/assets/css/pano-tokens.css"))).toBe(true);
    expect(existsSync(join(dir, "static/assets/css/pano-fallback-icons.css"))).toBe(true);
  });

  test("bundle-internal-libs finds Bootstrap at the workspace root", () => {
    const dir = makeTheme({}, { workspace: true });
    const result = run(bundleJs, dir);

    expect(result.code).toBe(0);
    expect(result.out).toContain("Copied Bootstrap bundle");
    const hash = readdirSync(join(dir, "static", "lib"))[0];
    expect(read(dir, `static/lib/${hash}/bootstrap/bootstrap.bundle.min.js`)).toContain("bootstrap");
  });

  test("bundle-internal-libs in a theme with its own node_modules behaves as before", () => {
    const dir = makeTheme();
    expect(run(bundleJs, dir).out).toContain("Copied Bootstrap bundle");
  });
});
