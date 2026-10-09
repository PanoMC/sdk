import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildCoreMeta, GENERATED_META_KEYS, readSnapshots, writeCoreMeta } from "../../contracts.js";
import { copyCoreMetaPlugin, copyManifestPlugin } from "../../../src/kit/vite-config.js";
import {
  binDir,
  cleanupAfterAll,
  cli,
  exists,
  importConfig,
  installPackage,
  makeTheme,
  read,
  readJson,
  tempDir,
  themeWithMarket,
  write,
  writeMarketPackage,
} from "./helpers.js";

cleanupAfterAll();

const thunk = () => import("./x.svelte");

const CONFIG = {
  views: {
    Navbar: thunk,
    LoginView: { contract: 1, component: thunk },
    "market:ProductCard": { contract: 2, controllers: ["market/cart", "market/format"], component: thunk },
    "market:PriceTag": thunk,
    "pano-plugin-market:StorePage": { contract: 1, component: thunk },
    "blog:Teaser": { contract: 3, component: thunk },
  },
  controllers: { "market/format": 1, "market/cart": 2 },
  routes: {
    add: { "/staff-team": "./src/pages/StaffTeam.svelte" },
    disable: ["/rules"],
    rename: { "/store": "/shop" },
  },
  home: {
    default: "landing",
    options: {
      posts: { label: "Posts" },
      landing: { label: { "en-US": "Landing", tr: "Açılış" }, page: "./src/pages/Landing.svelte" },
      store: { label: "Store", path: "/store" },
      custom: { label: "Custom page", path: "*" },
    },
  },
  urls: { "auth.login": "/sign-in", "market.order": false },
  settingsSchema: { tabs: { general: ["heroTitle"] }, defaultTab: "general" },
};

function snapshotsFor(...namespaces) {
  const theme = makeTheme();
  for (const ns of namespaces) {
    const pkg = tempDir("tc40-pkg-");
    writeMarketPackage(pkg, { ns, pluginId: `pano-plugin-${ns}` });
    installPackage(theme, pkg, `pano-plugin-${ns}`);
  }
  cli(theme, ["contracts", "pull"]);
  return readSnapshots(theme);
}

describe("buildCoreMeta", () => {
  test("derives overrides, engine, supports, controllers and overrideControllers", () => {
    const meta = buildCoreMeta({ config: CONFIG, snapshots: snapshotsFor("market") });

    expect(meta.overrides).toEqual({
      LoginView: 1,
      Navbar: 1,
      "market:PriceTag": 1,
      "market:ProductCard": 2,
      // the plugin id alias is written with the namespace
      "market:StorePage": 1,
      "blog:Teaser": 3,
    });
    expect(Object.keys(meta.overrides)).toEqual([...Object.keys(meta.overrides)].sort());

    // the bundled engine contract of each overridden engine view; plugin views are not in it
    expect(meta.engine).toEqual({ LoginView: 1, Navbar: 1 });
    // views per plugin id; the plugin id comes from the snapshot, else pano-plugin-<ns>
    expect(meta.supports).toEqual({ "pano-plugin-blog": { views: 1 }, "pano-plugin-market": { views: 3 } });
    expect(meta.controllers).toEqual({ "market/cart": 2, "market/format": 1 });
    expect(meta.overrideControllers).toEqual({ "market:ProductCard": ["market/cart", "market/format"] });
  });

  test("home, routes, urls and settingsSchema", () => {
    const meta = buildCoreMeta({ config: CONFIG });

    expect(meta.home.default).toBe("landing");
    expect(meta.home.options.posts).toEqual({ label: "Posts", kind: "posts" });
    expect(meta.home.options.landing).toEqual({ label: { "en-US": "Landing", tr: "Açılış" }, kind: "page" });
    expect(meta.home.options.store).toEqual({ label: "Store", kind: "path", path: "/store" });
    expect(meta.home.options.custom).toEqual({ label: "Custom page", kind: "custom", path: "*" });
    // the page file is a build detail and does not go to the backend
    expect(JSON.stringify(meta.home)).not.toContain("Landing.svelte");

    expect(meta.routes).toEqual({ rename: { "/store": "/shop" }, disable: ["/rules"], add: ["/staff-team"] });
    expect(meta.urls).toEqual({ "auth.login": "/sign-in", "market.order": false });
    expect(meta.settingsSchema).toEqual({ tabs: { general: ["heroTitle"] }, defaultTab: "general" });
  });

  test("a theme that sets nothing gets empty maps and no optional keys", () => {
    const meta = buildCoreMeta({ config: {} });
    expect(meta).toEqual({ overrides: {}, engine: {}, supports: {}, controllers: {}, overrideControllers: {} });
    expect(Object.keys(buildCoreMeta({ config: CONFIG }))).toEqual(GENERATED_META_KEYS);
  });

  test("author keys are kept and generated keys are replaced or dropped", () => {
    const existing = {
      tier: 2,
      baseTheme: "vanilla-theme",
      coreVersion: "0.0.1",
      overrides: { Stale: 9 },
      urls: { old: "/old" },
      home: { default: "x", options: {} },
    };
    const meta = buildCoreMeta({ config: { views: { Navbar: thunk } }, existing });

    expect(meta.tier).toBe(2);
    expect(meta.baseTheme).toBe("vanilla-theme");
    expect(meta.coreVersion).toBe("0.0.1");
    expect(meta.overrides).toEqual({ Navbar: 1 });
    expect("urls" in meta).toBe(false);
    expect("home" in meta).toBe(false);
    // author keys come first, generated keys after
    expect(Object.keys(meta).slice(0, 3)).toEqual(["tier", "baseTheme", "coreVersion"]);
  });

  test("an unknown engine name is not listed under engine", () => {
    expect(buildCoreMeta({ config: { views: { NotAView: thunk } } }).engine).toEqual({});
  });
});

describe("writeCoreMeta and sync", () => {
  test("writes core-meta.json once and reports no change the second time", () => {
    const theme = makeTheme();
    const first = writeCoreMeta({ themeDir: theme, config: { views: { Navbar: thunk } } });
    expect(first.changed).toBe(true);
    expect(readJson(theme, "core-meta.json").overrides).toEqual({ Navbar: 1 });
    expect(read(theme, "core-meta.json").endsWith("\n")).toBe(true);
    expect(writeCoreMeta({ themeDir: theme, config: { views: { Navbar: thunk } } }).changed).toBe(false);
  });

  test("theme-core sync writes plugin-contracts/ and core-meta.json from theme.config.js", async () => {
    const config = `export default {
  views: {
    "market:ProductCard": { contract: 1, controllers: ["market/cart"], component: () => import("./src/views/market/ProductCard.svelte") },
    Navbar: () => import("./src/views/Navbar.svelte"),
  },
  controllers: { "market/cart": 1 },
  routes: { rename: { "/store": "/shop" } },
  settingsSchema: { tabs: { general: ["heroTitle"] } },
};
`;
    const { theme } = themeWithMarket({ config, packageOptions: { productCardContract: 2 } });
    write(theme, "core-meta.json", JSON.stringify({ tier: 2 }));
    write(theme, "src/views/Navbar.svelte", "<nav></nav>\n");
    write(theme, "src/views/market/ProductCard.svelte", "<div></div>\n");

    const run = cli(theme, ["sync"]);
    expect(run.code).toBe(0);
    expect(run.out).toContain("plugin-contracts/market: new snapshot of pano-plugin-market");
    expect(run.out).toContain("core-meta.json written");

    expect(exists(theme, "plugin-contracts/market/views.json")).toBe(true);
    const meta = readJson(theme, "core-meta.json");
    expect(meta.tier).toBe(2);
    expect(meta.overrides).toEqual({ Navbar: 1, "market:ProductCard": 1 });
    expect(meta.engine).toEqual({ Navbar: 1 });
    expect(meta.supports).toEqual({ "pano-plugin-market": { views: 1 } });
    expect(meta.routes).toEqual({ rename: { "/store": "/shop" }, disable: [], add: [] });
    expect(meta.controllers).toEqual({ "market/cart": 1 });
    expect(meta.overrideControllers).toEqual({ "market:ProductCard": ["market/cart"] });
    expect(meta.settingsSchema).toEqual({ tabs: { general: ["heroTitle"] } });

    // a second sync prints the changed views when the plugin moves on, and leaves core-meta.json alone
    const again = cli(theme, ["sync"]);
    expect(again.out).toContain("core-meta.json unchanged");
    expect(again.out).not.toContain("snapshot of");
    expect((await importConfig(theme)).views["market:ProductCard"].contract).toBe(1);
  });

  test("sync prints the views whose contract changed", () => {
    const { theme, pkg } = themeWithMarket();
    cli(theme, ["sync"]);
    const views = JSON.parse(read(pkg, "contract/views.json"));
    views.views["market:PriceTag"].contract = 5;
    write(pkg, "contract/views.json", JSON.stringify(views));
    installPackage(theme, pkg, "pano-plugin-market");
    const run = cli(theme, ["sync"]);
    expect(run.out).toContain("~ market:PriceTag (contract 1 -> 5)");
  });
});

describe("build plugins of the vite config", () => {
  const cwd = process.cwd();
  afterEach(() => process.chdir(cwd));

  async function runPlugin(plugin, themeDir) {
    process.chdir(themeDir);
    plugin.configResolved?.();
    await plugin.closeBundle();
    process.chdir(cwd);
  }

  test("the manifest gets apiLevel from the engine's package.json", async () => {
    const theme = makeTheme({ files: { "manifest.json": JSON.stringify({ id: "t", title: "T", version: "1.0.0" }) } });
    mkdirSync(join(theme, "build"));
    await runPlugin(copyManifestPlugin(), theme);

    const built = readJson(theme, "build/manifest.json");
    const enginePkg = JSON.parse(read(binDir, "../package.json"));
    expect(enginePkg.pano.apiLevel).toBe(1);
    expect(built).toEqual({ id: "t", title: "T", version: "1.0.0", apiLevel: 1 });
    // the source manifest is untouched
    expect(readJson(theme, "manifest.json").apiLevel).toBeUndefined();
  });

  test("a manifest that sets apiLevel keeps it, byte for byte", async () => {
    const source = '{ "id": "t",   "apiLevel": 0 }\n';
    const theme = makeTheme({ files: { "manifest.json": source } });
    mkdirSync(join(theme, "build"));
    await runPlugin(copyManifestPlugin(), theme);
    expect(read(theme, "build/manifest.json")).toBe(source);
  });

  test("a manifest that is not JSON is copied as it is", async () => {
    const theme = makeTheme({ files: { "manifest.json": "{ not json" } });
    mkdirSync(join(theme, "build"));
    await runPlugin(copyManifestPlugin(), theme);
    expect(read(theme, "build/manifest.json")).toBe("{ not json");
  });

  test("the build writes core-meta.json from the config, with author keys and coreVersion", async () => {
    const config = `export default {
  views: { Navbar: () => import("./src/views/Navbar.svelte") },
  routes: { disable: ["/rules"] },
};
`;
    const theme = makeTheme({ config, files: { "core-meta.json": JSON.stringify({ tier: 2, coreVersion: "old" }) } });
    mkdirSync(join(theme, "build"));
    await runPlugin(copyCoreMetaPlugin(), theme);

    const built = readJson(theme, "build/core-meta.json");
    const corePkg = JSON.parse(read(binDir, "../package.json"));
    expect(built.tier).toBe(2);
    expect(built.coreVersion).toBe(corePkg.version);
    expect(built.overrides).toEqual({ Navbar: 1 });
    expect(built.engine).toEqual({ Navbar: 1 });
    expect(built.routes).toEqual({ rename: {}, disable: ["/rules"], add: [] });
    // the committed file was not touched by the build
    expect(readJson(theme, "core-meta.json").coreVersion).toBe("old");
  });

  test("a theme without a core-meta.json still gets one in build/", async () => {
    const theme = makeTheme();
    mkdirSync(join(theme, "build"));
    await runPlugin(copyCoreMetaPlugin(), theme);
    expect(readJson(theme, "build/core-meta.json").overrides).toEqual({});
  });

  test("a config that cannot be imported keeps the committed core-meta.json", async () => {
    const theme = makeTheme({ config: "export default {{{", files: { "core-meta.json": JSON.stringify({ tier: 1, overrides: { Navbar: 1 } }) } });
    mkdirSync(join(theme, "build"));
    await runPlugin(copyCoreMetaPlugin(), theme);
    const built = readJson(theme, "build/core-meta.json");
    expect(built.overrides).toEqual({ Navbar: 1 });
    expect(built.coreVersion).toBeTruthy();
  });
});

describe("svelte config", () => {
  test("adds the $contracts alias and keeps the author's aliases", () => {
    // the factory imports its toolchain from the theme: two stubs stand in for it
    const theme = makeTheme({
      files: {
        "node_modules/svelte-preprocess/package.json": JSON.stringify({ name: "svelte-preprocess", type: "module", main: "index.js" }),
        "node_modules/svelte-preprocess/index.js": "export default () => ({});\n",
        "node_modules/@sveltejs/adapter-node/package.json": JSON.stringify({ name: "@sveltejs/adapter-node", type: "module", main: "index.js" }),
        "node_modules/@sveltejs/adapter-node/index.js": "export default () => ({ name: 'stub' });\n",
      },
    });
    const url = "file://" + join(theme, "svelte.config.js");
    const spawn = spawnSync(
      "bun",
      [
        "-e",
        `const { createSvelteConfig } = await import(${JSON.stringify(join(binDir, "..", "src", "kit", "svelte-config.js"))});
         const a = await createSvelteConfig(${JSON.stringify(url)});
         const b = await createSvelteConfig(${JSON.stringify(url)}, { alias: { $x: "src/x" } });
         console.log(JSON.stringify([a.kit.alias, b.kit.alias]));`,
      ],
      { cwd: theme, encoding: "utf8" },
    );

    expect(spawn.stderr).toBe("");
    expect(spawn.status).toBe(0);
    const [plain, extra] = JSON.parse(spawn.stdout.trim().split("\n").at(-1));
    expect(plain).toEqual({ $contracts: "plugin-contracts" });
    expect(extra).toEqual({ $contracts: "plugin-contracts", $x: "src/x" });
  });
});
