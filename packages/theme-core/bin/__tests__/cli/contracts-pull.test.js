import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pullContracts } from "../../contracts.js";
import {
  cleanupAfterAll,
  cli,
  exists,
  installPackage,
  makeTheme,
  pluginMinDir,
  read,
  readJson,
  tempDir,
  themeWithMarket,
  write,
  writeMarketPackage,
} from "./helpers.js";

cleanupAfterAll();

describe("contracts pull", () => {
  test("copies contract/ without src/ to plugin-contracts/<ns>/", () => {
    const { theme } = themeWithMarket();
    const run = cli(theme, ["contracts", "pull"]);
    expect(run.code).toBe(0);
    expect(run.out).toContain("plugin-contracts/market: new snapshot of pano-plugin-market (3 views)");

    expect(exists(theme, "plugin-contracts/market/views.json")).toBe(true);
    expect(exists(theme, "plugin-contracts/market/controllers.json")).toBe(true);
    expect(exists(theme, "plugin-contracts/market/controllers.types.js")).toBe(true);
    expect(exists(theme, "plugin-contracts/market/src")).toBe(false);
    expect(exists(theme, "plugin-contracts/market/_lib")).toBe(false);
    expect(readJson(theme, "plugin-contracts/market/views.json").views["market:StorePage"].page).toEqual({ path: "/store" });
  });

  test("a second pull has nothing to do", () => {
    const { theme } = themeWithMarket();
    cli(theme, ["contracts", "pull"]);
    const run = cli(theme, ["contracts", "pull"]);
    expect(run.code).toBe(0);
    expect(run.out).toContain("up to date");
  });

  test("prints the views that changed: contract bump, new view, removed view", () => {
    const { theme, pkg } = themeWithMarket();
    cli(theme, ["contracts", "pull"]);

    const views = JSON.parse(read(pkg, "contract/views.json"));
    views.views["market:ProductCard"].contract = 2;
    views.views["market:PriceTag"].props = { price: { type: "any", required: true } };
    views.views["market:NavCart"] = { ...views.views["market:PriceTag"], contract: 1 };
    delete views.views["market:StorePage"];
    write(pkg, "contract/views.json", JSON.stringify(views));
    installPackage(theme, pkg, "pano-plugin-market");

    const run = cli(theme, ["contracts", "pull"]);
    expect(run.code).toBe(0);
    expect(run.out).toContain("plugin-contracts/market: pano-plugin-market changed");
    expect(run.out).toContain("~ market:ProductCard (contract 1 -> 2)");
    expect(run.out).toContain("~ market:PriceTag (props changed)");
    expect(run.out).toContain("+ market:NavCart (new view)");
    expect(run.out).toContain("- market:StorePage (removed)");
    expect(readJson(theme, "plugin-contracts/market/views.json").views["market:ProductCard"].contract).toBe(2);
  });

  test("a controller-only change updates the snapshot without a view listing", () => {
    const { theme, pkg } = themeWithMarket();
    cli(theme, ["contracts", "pull"]);
    const controllers = JSON.parse(read(pkg, "contract/controllers.json"));
    controllers["market/cart"].version = 2;
    write(pkg, "contract/controllers.json", JSON.stringify(controllers));
    installPackage(theme, pkg, "pano-plugin-market");

    const run = cli(theme, ["contracts", "pull"]);
    expect(run.out).toContain("controller contract updated");
    expect(readJson(theme, "plugin-contracts/market/controllers.json")["market/cart"].version).toBe(2);
  });

  test("files the plugin no longer ships are removed from the snapshot", () => {
    const { theme, pkg } = themeWithMarket();
    cli(theme, ["contracts", "pull"]);
    execFileSync("rm", [join(pkg, "contract", "controllers.types.js")]);
    installPackage(theme, pkg, "pano-plugin-market");
    // installPackage copies over: remove the stale file in the installed copy as a build would
    execFileSync("rm", ["-f", join(theme, "plugins", "pano-plugin-market", "contract", "controllers.types.js")]);

    cli(theme, ["contracts", "pull"]);
    expect(exists(theme, "plugin-contracts/market/controllers.types.js")).toBe(false);
    expect(exists(theme, "plugin-contracts/market/views.json")).toBe(true);
  });

  test("a snapshot of a plugin that is not installed any more is kept", () => {
    const { theme } = themeWithMarket();
    cli(theme, ["contracts", "pull"]);
    execFileSync("rm", ["-rf", join(theme, "plugins")]);
    const run = cli(theme, ["contracts", "pull"]);
    expect(run.code).toBe(0);
    expect(exists(theme, "plugin-contracts/market/views.json")).toBe(true);
  });

  test("two plugins are snapshotted side by side", () => {
    const { theme } = themeWithMarket();
    const other = tempDir("tc40-pkg-");
    writeMarketPackage(other, { ns: "shop", pluginId: "pano-plugin-shop" });
    installPackage(theme, other, "pano-plugin-shop");
    cli(theme, ["contracts", "pull"]);
    expect(exists(theme, "plugin-contracts/market/views.json")).toBe(true);
    expect(exists(theme, "plugin-contracts/shop/views.json")).toBe(true);
    expect(Object.keys(readJson(theme, "plugin-contracts/shop/views.json").views)).toContain("shop:ProductCard");
  });

  test("a plugin folder without a contract (an old plugin) is ignored", () => {
    const theme = makeTheme({ files: { "plugins/pano-plugin-old/manifest.json": "{}", "plugins/pano-plugin-old/client/client.mjs": "" } });
    const run = cli(theme, ["contracts", "pull"]);
    expect(run.code).toBe(0);
    expect(run.out).toContain("no plugin package");
    expect(exists(theme, "plugin-contracts")).toBe(false);
  });

  test("--from reads a folder or a zip without touching plugins/", () => {
    const pkg = tempDir("tc40-from-");
    writeMarketPackage(pkg);

    const a = makeTheme();
    expect(cli(a, ["contracts", "pull", "--from", pkg]).code).toBe(0);
    expect(exists(a, "plugin-contracts/market/views.json")).toBe(true);
    expect(exists(a, "plugins")).toBe(false);

    const zip = join(tempDir("tc40-zip-"), "plugin-ui.zip");
    execFileSync("zip", ["-q", "-r", zip, "."], { cwd: pkg });
    const b = makeTheme();
    expect(cli(b, ["contracts", "pull", "--from", zip]).code).toBe(0);
    expect(exists(b, "plugin-contracts/market/controllers.json")).toBe(true);
  });

  test("a folder of packages is read as one pull", () => {
    const folder = tempDir("tc40-plugins-");
    writeMarketPackage(join(folder, "pano-plugin-market"));
    writeMarketPackage(join(folder, "pano-plugin-shop"), { ns: "shop", pluginId: "pano-plugin-shop" });
    const theme = makeTheme();
    expect(cli(theme, ["contracts", "pull", "--from", folder]).code).toBe(0);
    expect(exists(theme, "plugin-contracts/market/views.json")).toBe(true);
    expect(exists(theme, "plugin-contracts/shop/views.json")).toBe(true);
  });

  test("--from without a package is an error", () => {
    const empty = tempDir("tc40-empty-");
    const run = cli(makeTheme(), ["contracts", "pull", "--from", empty]);
    expect(run.code).toBe(1);
    expect(run.out).toContain("no plugin package");
  });

  test("an unknown contracts subcommand prints the usage", () => {
    const run = cli(makeTheme(), ["contracts", "push"]);
    expect(run.code).toBe(1);
    expect(run.out).toContain("contracts pull");
  });

  test("the library call reports changes for sync and dev start", () => {
    const { theme, pkg } = themeWithMarket();
    const lines = [];
    const first = pullContracts({ themeDir: theme, log: (line) => lines.push(line) });
    expect(first.changes.map((c) => c.namespace)).toEqual(["market"]);
    expect(first.changes[0].first).toBe(true);

    const quiet = [];
    const again = pullContracts({ themeDir: theme, log: (line) => quiet.push(line) });
    expect(again.changes).toEqual([]);
    expect(again.unchanged).toBe(1);
    expect(quiet).toEqual([]);
    expect(lines.length).toBeGreaterThan(0);
    expect(pkg).toBeTruthy();
  });
});

describe.skipIf(!pluginMinDir)("contracts pull of the built test-fixtures/plugin-min", () => {
  test("snapshots the fixture", () => {
    const theme = makeTheme();
    installPackage(theme, pluginMinDir, "pano-plugin-min");
    const run = cli(theme, ["contracts", "pull"]);
    expect(run.code).toBe(0);
    expect(run.out).toContain("plugin-contracts/min: new snapshot of pano-plugin-min (1 views)");
    expect(readJson(theme, "plugin-contracts/min/controllers.json")["min/greeter"].version).toBe(1);
    expect(exists(theme, "plugin-contracts/min/src")).toBe(false);
  });
});
