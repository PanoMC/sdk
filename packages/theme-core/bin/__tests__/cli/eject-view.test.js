import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  cleanupAfterAll,
  cli,
  exists,
  importConfig,
  makeTheme,
  pluginMinDir,
  read,
  readJson,
  tempDir,
  themeWithMarket,
  write,
  writeMarketPackage,
  installPackage,
} from "./helpers.js";

cleanupAfterAll();

describe("eject-view of a plugin view", () => {
  test("copies the source without load and view, rewrites view imports, copies the helper closure", () => {
    const { theme } = themeWithMarket();
    const run = cli(theme, ["eject-view", "market:ProductCard"]);
    expect(run.code).toBe(0);

    const view = read(theme, "src/views/market/ProductCard.svelte");
    // load and view are gone, with their doc comments; other module exports stay
    expect(view).not.toContain("export const view");
    expect(view).not.toContain("export async function load");
    expect(view).not.toContain("Where the view mounts");
    expect(view).not.toContain("Data of the view");
    expect(view).toContain("export const prerender = false;");

    // the other view became a proxy
    expect(view).not.toContain("import PriceTag");
    expect(view).toContain('import { pluginView } from "$pano/registry/view.js";');
    expect(view).toContain('const PriceTag = pluginView("market:PriceTag");');
    expect(view.indexOf("pluginView }")).toBeLessThan(view.indexOf("const PriceTag"));

    // helper imports point at the copy next to the view
    expect(view).toContain("from './_lib/lib/sale.js'");
    expect(view).not.toContain("../_lib/");
    expect(exists(theme, "src/views/market/_lib/lib/sale.js")).toBe(true);
    // the closure is followed: sale.js imports fmt.js
    expect(exists(theme, "src/views/market/_lib/lib/fmt.js")).toBe(true);
    expect(read(theme, "src/views/market/_lib/lib/fmt.js")).toContain("percent");

    // the rest of the markup is untouched
    expect(view).toContain('<div class="market-product-card">');
    expect(view).toContain("<PriceTag price={product.price}");
  });

  test("a module script that held only load and view disappears", () => {
    const { theme } = themeWithMarket();
    cli(theme, ["eject-view", "market:StorePage"]);
    const view = read(theme, "src/views/market/StorePage.svelte");
    expect(view).not.toContain("<script module>");
    expect(view).not.toContain("view =");
    expect(view.trimStart().startsWith("<script>")).toBe(true);
    expect(view).toContain('const ProductCard = pluginView("market:ProductCard");');
  });

  test("writes the object-form entry with contract and controllers, and the missing pins", async () => {
    const { theme } = themeWithMarket({ packageOptions: { productCardContract: 2, cartVersion: 3 } });
    const run = cli(theme, ["eject-view", "market:ProductCard"]);
    expect(run.code).toBe(0);
    expect(run.out).toContain("market/cart@3");

    const config = await importConfig(theme);
    const entry = config.views["market:ProductCard"];
    expect(entry.contract).toBe(2);
    expect(entry.controllers).toEqual(["market/cart", "market/format"]);
    expect(typeof entry.component).toBe("function");
    expect(config.controllers).toEqual({ "market/cart": 3, "market/format": 1 });

    const text = read(theme, "theme.config.js");
    expect(text).toContain('"market:ProductCard": {');
    expect(text).toContain('component: () => import("./src/views/market/ProductCard.svelte")');
  });

  test("writes the snapshot when it is missing, without src/", () => {
    const { theme } = themeWithMarket();
    expect(exists(theme, "plugin-contracts/market/views.json")).toBe(false);
    cli(theme, ["eject-view", "market:PriceTag"]);
    expect(exists(theme, "plugin-contracts/market/views.json")).toBe(true);
    expect(exists(theme, "plugin-contracts/market/controllers.json")).toBe(true);
    expect(exists(theme, "plugin-contracts/market/controllers.types.js")).toBe(true);
    expect(exists(theme, "plugin-contracts/market/src")).toBe(false);
  });

  test("keeps the author's formatting, comments and other keys", async () => {
    const config = `// my theme
import { something } from "./local.js";

export default {
  // overrides
  views: {
    Navbar: () => import("./src/views/Navbar.svelte"), // keep this comment
  },
  settingsSchema: { tabs: { general: ["heroTitle"] } },
};
`;
    const { theme } = themeWithMarket({ config });
    write(theme, "local.js", "export const something = 1;\n");
    write(theme, "src/views/Navbar.svelte", "<nav></nav>\n");
    expect(cli(theme, ["eject-view", "market:PriceTag"]).code).toBe(0);

    const text = read(theme, "theme.config.js");
    expect(text).toContain("// my theme");
    expect(text).toContain("// overrides");
    expect(text).toContain('Navbar: () => import("./src/views/Navbar.svelte"), // keep this comment');
    expect(text).toContain('settingsSchema: { tabs: { general: ["heroTitle"] } },');

    const loaded = await importConfig(theme);
    expect(Object.keys(loaded.views)).toEqual(["Navbar", "market:PriceTag"]);
    expect(loaded.views["market:PriceTag"].contract).toBe(1);
    expect(loaded.views["market:PriceTag"].controllers).toBeUndefined();
  });

  test("adds `views` when the config has none", async () => {
    const { theme } = themeWithMarket({ config: "export default {\n  home: { default: 'posts' },\n};\n" });
    expect(cli(theme, ["eject-view", "market:PriceTag"]).code).toBe(0);
    const loaded = await importConfig(theme);
    expect(loaded.home).toEqual({ default: "posts" });
    expect(loaded.views["market:PriceTag"].contract).toBe(1);
  });

  test("a second run changes nothing and does not duplicate the entry", () => {
    const { theme } = themeWithMarket();
    cli(theme, ["eject-view", "market:ProductCard"]);
    const before = read(theme, "theme.config.js");
    const run = cli(theme, ["eject-view", "market:ProductCard"]);
    expect(run.code).toBe(0);
    expect(run.out).toContain("unchanged");
    expect(read(theme, "theme.config.js")).toBe(before);
    expect(exists(theme, "src/views/market/ProductCard.svelte.new")).toBe(false);
  });

  test("an existing different override gets <file>.new and keeps the author's file", () => {
    const { theme, pkg } = themeWithMarket();
    cli(theme, ["eject-view", "market:ProductCard"]);
    write(theme, "src/views/market/ProductCard.svelte", "<div>my own markup</div>\n");

    // the plugin ships contract 2 with new markup
    write(pkg, "contract/src/components/ProductCard.svelte", read(pkg, "contract/src/components/ProductCard.svelte").replace("<h3>", "<h2>").replace("</h3>", "</h2>"));
    installPackage(theme, pkg, "pano-plugin-market");

    const run = cli(theme, ["eject-view", "market:ProductCard"]);
    expect(run.code).toBe(0);
    expect(read(theme, "src/views/market/ProductCard.svelte")).toBe("<div>my own markup</div>\n");
    expect(read(theme, "src/views/market/ProductCard.svelte.new")).toContain("<h2>");
    expect(run.out).toContain("ProductCard.svelte.new");
    expect(run.out).toContain("theme-core accept market:ProductCard");
  });

  test("a different existing helper gets .new, an identical one is left", () => {
    const { theme } = themeWithMarket();
    write(theme, "src/views/market/_lib/lib/sale.js", "// my own helper\nexport const onSale = () => true;\n");
    const run = cli(theme, ["eject-view", "market:ProductCard"]);
    expect(run.code).toBe(0);
    expect(read(theme, "src/views/market/_lib/lib/sale.js")).toContain("my own helper");
    expect(read(theme, "src/views/market/_lib/lib/sale.js.new")).toContain("percent");
    // fmt.js did not exist and is created, not .new
    expect(exists(theme, "src/views/market/_lib/lib/fmt.js")).toBe(true);
    expect(exists(theme, "src/views/market/_lib/lib/fmt.js.new")).toBe(false);

    // ejecting another view with the same helper leaves the (now equal) fmt.js alone
    const second = cli(theme, ["eject-view", "market:StorePage"]);
    expect(second.code).toBe(0);
    expect(exists(theme, "src/views/market/_lib/lib/fmt.js.new")).toBe(false);
  });

  test("ns:* ejects every view, --pages only the pages", async () => {
    const all = themeWithMarket();
    expect(cli(all.theme, ["eject-view", "market:*"]).code).toBe(0);
    expect(Object.keys((await importConfig(all.theme)).views).sort()).toEqual(["market:PriceTag", "market:ProductCard", "market:StorePage"]);
    expect(exists(all.theme, "src/views/market/PriceTag.svelte")).toBe(true);

    const pages = themeWithMarket();
    expect(cli(pages.theme, ["eject-view", "market:*", "--pages"]).code).toBe(0);
    expect(Object.keys((await importConfig(pages.theme)).views)).toEqual(["market:StorePage"]);
    expect(exists(pages.theme, "src/views/market/ProductCard.svelte")).toBe(false);
  });

  test("the full plugin id is accepted as an alias of the namespace", async () => {
    const { theme } = themeWithMarket();
    expect(cli(theme, ["eject-view", "pano-plugin-market:PriceTag"]).code).toBe(0);
    expect(Object.keys((await importConfig(theme)).views)).toEqual(["market:PriceTag"]);
  });

  test("refuses a package built with PANO_VIEW_IMPORTS=warn and writes nothing", () => {
    const { theme } = themeWithMarket({ packageOptions: { viewImports: "warn" } });
    const run = cli(theme, ["eject-view", "market:ProductCard"]);
    expect(run.code).toBe(1);
    expect(run.out).toContain("market:ProductCard comes from a plugin built with PANO_VIEW_IMPORTS=warn");
    expect(run.out).toContain("this plugin version cannot be ejected; update the plugin");
    expect(exists(theme, "src/views")).toBe(false);
    expect(read(theme, "theme.config.js")).toBe("export default {\n  views: {},\n};\n");
  });

  test("an unknown view and an uninstalled plugin are errors that name the way out", () => {
    const { theme } = themeWithMarket();
    const unknown = cli(theme, ["eject-view", "market:Nope"]);
    expect(unknown.code).toBe(1);
    expect(unknown.out).toContain("no view 'market:Nope'");
    expect(unknown.out).toContain("ProductCard");

    const missing = cli(theme, ["eject-view", "shop:Thing"]);
    expect(missing.code).toBe(1);
    expect(missing.out).toContain("not installed");
    expect(missing.out).toContain("--from");
  });

  test("--from reads a package folder, a plugin repo and a zip", async () => {
    const pkg = tempDir("tc40-from-");
    writeMarketPackage(pkg);

    // package folder
    const a = makeTheme();
    expect(cli(a, ["eject-view", "market:PriceTag", "--from", pkg]).code).toBe(0);
    expect(exists(a, "src/views/market/PriceTag.svelte")).toBe(true);
    expect(exists(a, "plugin-contracts/market/views.json")).toBe(true);

    // plugin repo layout: <repo>/src/main/resources/plugin-ui
    const repo = tempDir("tc40-repo-");
    writeMarketPackage(join(repo, "src", "main", "resources", "plugin-ui"));
    const b = makeTheme();
    expect(cli(b, ["eject-view", "market:PriceTag", `--from=${repo}`]).code).toBe(0);
    expect(exists(b, "src/views/market/PriceTag.svelte")).toBe(true);

    // zip
    const zip = join(tempDir("tc40-zip-"), "plugin-ui.zip");
    execFileSync("zip", ["-q", "-r", zip, "."], { cwd: pkg });
    const c = makeTheme();
    const run = cli(c, ["eject-view", "market:ProductCard", "--from", zip]);
    expect(run.code).toBe(0);
    expect(Object.keys((await importConfig(c)).views)).toEqual(["market:ProductCard"]);
    expect(exists(c, "src/views/market/_lib/lib/sale.js")).toBe(true);
  });

  test("--from with nothing to read fails", () => {
    const theme = makeTheme();
    const run = cli(theme, ["eject-view", "market:PriceTag", "--from", join(tempDir(), "missing")]);
    expect(run.code).toBe(1);
    expect(run.out).toContain("does not exist");
  });

  test("without theme.config.js the files are written and the entry is printed", () => {
    const { theme } = themeWithMarket({ config: null });
    const run = cli(theme, ["eject-view", "market:PriceTag"]);
    expect(run.code).toBe(0);
    expect(exists(theme, "src/views/market/PriceTag.svelte")).toBe(true);
    expect(exists(theme, "theme.config.js")).toBe(false);
    expect(run.out).toContain("no theme.config.js");
  });

  test("a config that is not an object literal gets the entries printed instead of a broken edit", () => {
    const config = "const views = makeViews();\nexport default { views };\n";
    const { theme } = themeWithMarket({ config });
    const run = cli(theme, ["eject-view", "market:PriceTag"]);
    expect(run.code).toBe(0);
    expect(read(theme, "theme.config.js")).toBe(config);
    expect(run.out).toContain("could not be edited automatically");
    expect(run.out).toContain('"market:PriceTag": { contract: 1');
  });

  test("controllers used in the source but missing from the package index are found", async () => {
    const { theme, pkg } = themeWithMarket();
    const index = JSON.parse(readFileSync(join(pkg, "pano-plugin.json"), "utf8"));
    index.views.PriceTag.controllers = {};
    writeFileSync(join(pkg, "pano-plugin.json"), JSON.stringify(index));
    write(pkg, "contract/src/components/PriceTag.svelte", `<script>\n  import { plugin } from '@panomc/sdk/controllers';\n  const cart = plugin("market").use("cart");\n</script>\n<span></span>\n`);
    installPackage(theme, pkg, "pano-plugin-market");

    expect(cli(theme, ["eject-view", "market:PriceTag"]).code).toBe(0);
    const loaded = await importConfig(theme);
    expect(loaded.views["market:PriceTag"].controllers).toEqual(["market/cart"]);
    expect(loaded.controllers["market/cart"]).toBe(1);
  });

  test("an existing pin is kept, not overwritten", async () => {
    const { theme } = themeWithMarket({
      config: 'export default {\n  views: {},\n  controllers: { "market/cart": 7 },\n};\n',
      packageOptions: { cartVersion: 2 },
    });
    expect(cli(theme, ["eject-view", "market:ProductCard"]).code).toBe(0);
    const loaded = await importConfig(theme);
    expect(loaded.controllers).toEqual({ "market/cart": 7, "market/format": 1 });
  });
});

describe("eject-view of an engine view", () => {
  test("copies the default and writes the object form with the engine contract", async () => {
    const theme = makeTheme();
    const run = cli(theme, ["eject-view", "LoginView"]);
    expect(run.code).toBe(0);
    expect(exists(theme, "src/views/LoginView.svelte")).toBe(true);

    const loaded = await importConfig(theme);
    expect(loaded.views.LoginView.contract).toBe(1);
    expect(typeof loaded.views.LoginView.component).toBe("function");
    expect(read(theme, "theme.config.js")).toContain('component: () => import("./src/views/LoginView.svelte")');
  });

  test("an engine part from views/parts can be ejected too", () => {
    const theme = makeTheme();
    expect(cli(theme, ["eject-view", "Posts"]).code).toBe(0);
    expect(exists(theme, "src/views/Posts.svelte")).toBe(true);
  });

  test("a second eject keeps the file and writes .new only when the default differs", () => {
    const theme = makeTheme();
    cli(theme, ["eject-view", "RulesView"]);
    write(theme, "src/views/RulesView.svelte", "<p>mine</p>\n");
    const run = cli(theme, ["eject-view", "RulesView"]);
    expect(run.code).toBe(0);
    expect(read(theme, "src/views/RulesView.svelte")).toBe("<p>mine</p>\n");
    expect(exists(theme, "src/views/RulesView.svelte.new")).toBe(true);
  });

  test("an unknown name is an error", () => {
    const theme = makeTheme();
    const run = cli(theme, ["eject-view", "Nonsense"]);
    expect(run.code).toBe(1);
    expect(run.out).toContain("no engine view named Nonsense");
  });

  test("no argument prints the usage", () => {
    const run = cli(makeTheme(), ["eject-view"]);
    expect(run.code).toBe(1);
    expect(run.out).toContain("usage");
  });
});

describe.skipIf(!pluginMinDir)("eject-view against the built test-fixtures/plugin-min", () => {
  test("ejects HelloPage with its helper and controller pin", async () => {
    const theme = makeTheme();
    installPackage(theme, pluginMinDir, "pano-plugin-min");
    const run = cli(theme, ["eject-view", "min:HelloPage"]);
    expect(run.code).toBe(0);

    const view = read(theme, "src/views/min/HelloPage.svelte");
    expect(view).not.toContain("export const view");
    expect(view).not.toContain("<script module>");
    expect(view).toContain("from './_lib/lib/greet.js'");
    expect(view).toContain('class="min-hello-page"');
    expect(read(theme, "src/views/min/_lib/lib/greet.js")).toContain("export function greet");

    const loaded = await importConfig(theme);
    expect(loaded.views["min:HelloPage"].contract).toBe(1);
    expect(JSON.parse(read(theme, "plugin-contracts/min/views.json")).views["min:HelloPage"].page).toEqual({ path: "/hello" });
  });
});
