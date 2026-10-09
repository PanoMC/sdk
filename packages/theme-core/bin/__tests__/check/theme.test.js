import { describe, expect, test } from "bun:test";
import { writePins } from "../../check.js";
import { at, check, makeTheme, read } from "./helpers.js";

const NAVBAR = `Navbar: () => import("./src/views/Navbar.svelte")`;
const config = (entries = NAVBAR, rest = "") => `export default { ${rest} views: { ${entries} } };\n`;
const withNavbar = (markup, extra = {}, cfg = config()) =>
  makeTheme({ snapshot: true, config: cfg, files: { "src/views/Navbar.svelte": markup, ...extra } });

describe("C7 block and pluginView placements", () => {
  test("a literal id missing from the snapshot is an error ending with the pull command", async () => {
    const msg = at(await check(withNavbar('<PluginBlock id="market:Nope" />')), "error", "C7");
    expect(msg).toHaveLength(1);
    expect(msg[0]).toEndWith("run: theme-core contracts pull");
    expect(msg[0]).toContain("src/views/Navbar.svelte:1");
  });

  test("pluginView() with an unknown id is an error; an engine name is checked against the contract", async () => {
    const dir = withNavbar(
      '<script>\n  import { pluginView } from "$pano/registry/view.js";\n  const A = pluginView("market:Gone");\n  const B = pluginView("Pagination");\n  const C = pluginView("Nothing");\n</script>',
    );
    expect(at(await check(dir), "error", "C7")).toHaveLength(2);
  });

  test("a dynamic id is a warning: its data loads in the browser", async () => {
    const report = await check(withNavbar("<script>let id = 'market:NavCart';</script><PluginBlock {id} /><PluginBlock id={id} />"));
    expect(at(report, "error", "C7")).toEqual([]);
    const msg = at(report, "warning", "C7");
    expect(msg).toHaveLength(2);
    expect(msg[0]).toContain("its data loads in the browser, not on the server");
  });

  test("a non-literal prop is a warning", async () => {
    const report = await check(withNavbar('<script>let n = 3;</script><PluginBlock id="market:ProductGrid" limit={n} category="vip" {...rest} />'));
    const msg = at(report, "warning", "C7");
    expect(msg).toHaveLength(1);
    expect(msg[0]).toContain("limit");
    expect(msg[0]).toContain("{...spread}");
    expect(at(report, "error", "C7")).toEqual([]);
  });

  test("no snapshot for the namespace is a warning", async () => {
    const dir = makeTheme({ config: config(), files: { "src/views/Navbar.svelte": '<PluginBlock id="market:ProductGrid" />' } });
    const report = await check(dir);
    expect(at(report, "error", "C7")).toEqual([]);
    expect(at(report, "warning", "C7")).toHaveLength(1);
  });

  test("control: literal ids and literal props, also in a nested theme file", async () => {
    const dir = withNavbar(
      '<script>import Cart from "./Cart.svelte";</script><PluginBlock id="market:ProductGrid" limit={8} category="vip" /><Cart />',
      { "src/views/Cart.svelte": '<PluginBlock id="pano-plugin-market:NavCart" />' },
    );
    const report = await check(dir);
    expect(at(report, "error", "C7")).toEqual([]);
    expect(at(report, "warning", "C7")).toEqual([]);
  });
});

describe("C8 claims", () => {
  test("a claimed injection is reported as info and never fails", async () => {
    const report = await check(withNavbar('<PluginBlock id="market:NavCart" />'));
    expect(at(report, "info", "C8")).toEqual(["theme claims 'market:NavCart': its automatic copy in 'navbar-right' is suppressed"]);
    expect(at(report, "error")).toEqual([]);
  });

  test("an explicit claims entry counts, claims: false removes it", async () => {
    const claimed = await check(withNavbar("<div></div>", {}, config(NAVBAR, `claims: { "market:NavCart": true },`)));
    expect(at(claimed, "info", "C8")).toHaveLength(1);
    const kept = await check(withNavbar('<PluginBlock id="market:NavCart" />', {}, config(NAVBAR, `claims: { "market:NavCart": false },`)));
    expect(at(kept, "info", "C8")).toEqual([]);
  });
});

describe("C9 routes", () => {
  const routes = (r) => makeTheme({ snapshot: true, config: `export default { routes: ${r} };\n`, files: { "src/pages/A.svelte": "<div></div>" } });

  test("an invalid pattern is an error", async () => {
    expect(at(await check(routes(`{ disable: ["no-slash"] }`)), "error", "C9")).toHaveLength(1);
  });

  test("a rename with different params is an error naming the entry", async () => {
    const msg = at(await check(routes(`{ rename: { "/store/[slug]": "/shop/[id]" } }`)), "error", "C9");
    expect(msg).toHaveLength(1);
    expect(msg[0]).toContain("/store/[slug]");
  });

  test("two renames to the same public path are an error", async () => {
    expect(at(await check(routes(`{ rename: { "/a": "/x", "/b": "/x" } }`)), "error", "C9")).toHaveLength(1);
  });

  test("nothing may target /posts or /__pano*", async () => {
    const msg = at(await check(routes(`{ rename: { "/store": "/posts", "/rules": "/__pano-x" } }`)), "error", "C9");
    expect(msg).toHaveLength(2);
  });

  test("add: path must be free, valid and have an existing file", async () => {
    const dir = routes(
      `{ add: { "/login": "./src/pages/A.svelte", "/posts": "./src/pages/A.svelte", "/__pano/x": "./src/pages/A.svelte", "/store": "./src/pages/A.svelte", "/staff": "./src/pages/Missing.svelte", "/ok": "./src/pages/A.svelte" } }`,
    );
    const msg = at(await check(dir), "error", "C9");
    expect(msg).toHaveLength(5);
    expect(msg.some((m) => m.includes('"/login"'))).toBe(true);
    expect(msg.some((m) => m.includes('"/store"'))).toBe(true);
    expect(msg.some((m) => m.includes("Missing.svelte"))).toBe(true);
    expect(msg.some((m) => m.includes('"/ok"'))).toBe(false);
  });

  test("add: a path renamed away is free again", async () => {
    const dir = routes(`{ rename: { "/store": "/shop" }, add: { "/store": "./src/pages/A.svelte" } }`);
    expect(at(await check(dir), "error", "C9")).toEqual([]);
  });

  test("control: a clean route config passes", async () => {
    const dir = routes(`{ rename: { "/store": "/shop" }, disable: ["/rules"], add: { "/staff-team": "./src/pages/A.svelte" } }`);
    expect(at(await check(dir), "error", "C9")).toEqual([]);
  });
});

describe("C10 home", () => {
  const home = (h) => makeTheme({ config: `export default { home: ${h} };\n`, files: { "src/pages/Landing.svelte": "<div></div>" } });

  test("default must be an option", async () => {
    const msg = at(await check(home(`{ default: "gone", options: { posts: { label: "Posts" } } }`)), "error", "C10");
    expect(msg).toHaveLength(1);
    expect(msg[0]).toContain("gone");
  });

  test("option ids are [a-z0-9-]+, page files exist, paths start with / or are *", async () => {
    const dir = home(
      `{ default: "posts", options: { posts: { label: "P" }, "Bad_Id": { label: "x" }, landing: { label: "L", page: "./src/pages/Nope.svelte" }, store: { label: "S", path: "store" }, custom: { label: "C", path: "*" } } }`,
    );
    const msg = at(await check(dir), "error", "C10");
    expect(msg).toHaveLength(3);
  });

  test("control: thunk page, string page, canonical path, custom", async () => {
    const dir = home(
      `{ default: "landing", options: { posts: { label: "P" }, landing: { label: { "en-US": "L" }, page: () => import("./src/pages/Landing.svelte") }, alt: { label: "A", page: "./src/pages/Landing.svelte" }, store: { label: "S", path: "/store" }, custom: { label: "C", path: "*" } } }`,
    );
    expect(at(await check(dir), "error", "C10")).toEqual([]);
  });
});

describe("C12 controller pins", () => {
  const useCart = '<script>\n  import { plugin } from "@panomc/sdk/controllers";\n  const cart = plugin("market").use("cart");\n</script>{#if cart}x{/if}';
  const cartEntry = `"market:ProductCard": { contract: 2, controllers: ["market/cart", "market/format"], component: () => import("./src/views/ProductCard.svelte") }`;
  const card = '<script>let { product } = $props();</script><div class="market-product-card"></div>';

  test("a missing pin is a warning ending with --fix; --fix writes it and the warning is gone", async () => {
    const dir = makeTheme({ snapshot: true, config: config(cartEntry), files: { "src/views/ProductCard.svelte": card } });
    const before = await check(dir);
    const msg = at(before, "warning", "C12");
    expect(msg).toHaveLength(2);
    for (const m of msg) expect(m).toEndWith("run: theme-core check --fix");

    const fixed = await check(dir, { fix: true });
    expect(at(fixed, "warning", "C12")).toEqual([]);
    expect(fixed.fixed).toHaveLength(2);
    const text = read(dir, "theme.config.js");
    expect(text).toContain('"market/cart": 2');
    expect(text).toContain('"market/format": 1');

    const after = await check(dir);
    expect(at(after, "warning", "C12")).toEqual([]);
    expect(at(after, "error")).toEqual([]);
  });

  test("a literal plugin('ns').use('name') in a theme page needs a pin too", async () => {
    const dir = makeTheme({ snapshot: true, config: config(""), files: { "src/pages/Header.svelte": useCart } });
    const msg = at(await check(dir), "warning", "C12");
    expect(msg).toHaveLength(1);
    expect(msg[0]).toContain("market/cart");
    expect(msg[0]).toContain("src/pages/Header.svelte:3");
  });

  test("a pin that differs from the snapshot is a warning; --fix re-pins and keeps other pins", async () => {
    const dir = makeTheme({
      snapshot: true,
      config: `export default {\n  controllers: { "market/cart": 1, "other/thing": 7 },\n  views: {},\n};\n`,
      files: { "src/pages/Header.svelte": useCart },
    });
    const msg = at(await check(dir), "warning", "C12");
    expect(msg).toHaveLength(1);
    expect(msg[0]).toContain("pinned to 1");
    await check(dir, { fix: true });
    const text = read(dir, "theme.config.js");
    expect(text).toContain('"market/cart": 2');
    expect(text).toContain('"other/thing": 7');
  });

  test("an unknown controller name is a warning (and --fix does not invent a pin)", async () => {
    const dir = makeTheme({ snapshot: true, config: config(""), files: { "src/pages/H.svelte": useCart.replace('"cart"', '"carts"') } });
    const msg = at(await check(dir, { fix: true }), "warning", "C12");
    expect(msg).toHaveLength(1);
    expect(read(dir, "theme.config.js")).not.toContain("controllers");
  });

  test("control: matching pins pass", async () => {
    const dir = makeTheme({
      snapshot: true,
      config: `export default { controllers: { "market/cart": 2 }, views: {} };\n`,
      files: { "src/pages/Header.svelte": useCart },
    });
    expect(at(await check(dir), "warning", "C12")).toEqual([]);
  });

  test("writePins: appends with a comma, replaces in place, inserts when absent, null when unlocatable", () => {
    const pins = new Map([["market/cart", 2]]);
    expect(writePins(`export default { controllers: { "a/b": 1 } };`, pins)).toContain(`"a/b": 1,\n`);
    expect(writePins(`export default { controllers: { 'market/cart': 1 } };`, pins)).toContain(`'market/cart': 2`);
    expect(writePins(`export default {};`, pins)).toContain('controllers: {\n    "market/cart": 2,');
    expect(writePins(`const c = {}; export default c;`, pins)).toBeNull();
    // a commented-out block is not the block
    expect(writePins(`// controllers: { "x/y": 1 }\nexport default {};`, pins)).toContain('"market/cart": 2');
  });
});

describe("C13 styles and provides.bootstrap", () => {
  const styled = (scss, cfg = "export default { views: {} };\n") => makeTheme({ config: cfg, files: { "src/styles/style.scss": scss } });
  const BOOTSTRAP = '@import "node_modules/bootstrap/scss/bootstrap";\n';
  const SDK_MAIN = '@import "node_modules/@panomc/sdk/core/scss/main";\n';

  test("Bootstrap imported directly without pano-tokens is an error naming the line to add", async () => {
    const msg = at(await check(styled(BOOTSTRAP)), "error", "C13");
    expect(msg).toHaveLength(1);
    expect(msg[0]).toContain("src/styles/style.scss:1");
    expect(msg[0]).toEndWith('@import "node_modules/@panomc/sdk/core/scss/pano-tokens";');
  });

  test("a direct import plus pano-tokens, or the SDK main file, passes", async () => {
    const tokens = '@import "node_modules/@panomc/sdk/core/scss/pano-tokens";\n';
    expect(at(await check(styled(BOOTSTRAP + tokens)), "error", "C13")).toEqual([]);
    const report = await check(styled(SDK_MAIN));
    expect(at(report, "error", "C13")).toEqual([]);
    expect(at(report, "warning", "C13")).toEqual([]);
  });

  test("provides.bootstrap false with a Bootstrap import is an error", async () => {
    const cfg = "export default { provides: { bootstrap: false }, views: {} };\n";
    expect(at(await check(styled(BOOTSTRAP, cfg)), "error", "C13")).toHaveLength(1);
    expect(at(await check(styled(SDK_MAIN, cfg)), "error", "C13")).toHaveLength(1);
  });

  test("provides.bootstrap false without an import passes and prints the browser floor once", async () => {
    const report = await check(styled(".a { color: red; }\n", "export default { provides: { bootstrap: false }, views: {} };\n"));
    expect(at(report, "error", "C13")).toEqual([]);
    expect(at(report, "info", "C13")).toHaveLength(1);
    expect(at(report, "info", "C13")[0]).toContain("Chrome 118");
  });

  test("no Bootstrap import while provides.bootstrap is not false is a warning naming the line to add", async () => {
    const msg = at(await check(styled(".a { color: red; }\n")), "warning", "C13");
    expect(msg).toHaveLength(1);
    expect(msg[0]).toContain('@import "node_modules/@panomc/sdk/core/scss/main"');
  });

  test("never reads static/style.css", async () => {
    const dir = makeTheme({
      config: "export default { provides: { bootstrap: false }, views: {} };\n",
      files: { "static/style.css": '/* @import "bootstrap/scss/bootstrap" */ .a{}', "src/styles/style.scss": ".a { color: red; }\n" },
    });
    expect(at(await check(dir), "error", "C13")).toEqual([]);
  });

  test("a theme without src/styles is not warned", async () => {
    expect(at(await check(makeTheme()), "warning", "C13")).toEqual([]);
  });
});

describe("C15 plugin lang overrides", () => {
  const lang = (files) => makeTheme({ files });

  test("invalid JSON, a non-object top and a bad folder name are errors", async () => {
    const dir = lang({
      "lang-overrides/plugins/market/tr.json": "{ nope",
      "lang-overrides/plugins/market/en-US.json": "[]",
      "lang-overrides/plugins/Market_X/tr.json": "{}",
      "lang-overrides/plugins/stray.json": "{}",
    });
    expect(at(await check(dir), "error", "C15")).toHaveLength(4);
  });

  test("control: valid files, the plugin id as folder alias", async () => {
    const dir = lang({
      "lang-overrides/plugins/market/tr.json": '{ "theme": { "store": { "title": "Dukkan" } } }',
      "lang-overrides/plugins/pano-plugin-pages/tr.json": "{}",
    });
    expect(at(await check(dir), "error", "C15")).toEqual([]);
  });
});

describe("C16 API paths are Pano routes", () => {
  const api = (text) => makeTheme({ files: { "src/pages/api.js": `import ApiUtil from "@panomc/sdk/utils/api";\n${text}\n` } });

  test("an unknown path is an error with the nearest route", async () => {
    const msg = at(await check(api('ApiUtil.get({ path: "/postz" });')), "error", "C16");
    expect(msg).toHaveLength(1);
    expect(msg[0]).toContain("src/pages/api.js:2");
    expect(msg[0]).toContain("did you mean '/posts'?");
  });

  test("a path starting with /api is an error", async () => {
    expect(at(await check(api('ApiUtil.get({ path: "/api/posts" });')), "error", "C16")).toHaveLength(1);
  });

  test("control: known paths and template holes pass", async () => {
    const report = await check(api('ApiUtil.get({ path: "/posts" });\nApiUtil.get({ path: `/posts/${url}` });'));
    expect(at(report, "error", "C16")).toEqual([]);
    expect(at(report, "warning", "C16")).toEqual([]);
  });
});

describe("--strict", () => {
  test("warnings become errors", async () => {
    const dir = makeTheme({ snapshot: true, config: config(`"market:Nope": () => import("./src/views/N.svelte")`), files: { "src/views/N.svelte": "<div></div>" } });
    const lax = await check(makeTheme({ config: config(`"other:X": () => import("./src/views/N.svelte")`), files: { "src/views/N.svelte": "<div></div>" } }));
    expect(lax.warnings).toHaveLength(1);
    expect(lax.problems).toEqual([]);
    const strict = await check(makeTheme({ config: config(`"other:X": () => import("./src/views/N.svelte")`), files: { "src/views/N.svelte": "<div></div>" } }), { strict: true });
    expect(strict.warnings).toEqual([]);
    expect(strict.problems).toHaveLength(1);
    expect(dir).toBeTruthy();
  });

  test("info stays info", async () => {
    const dir = withNavbar('<PluginBlock id="market:NavCart" />');
    const strict = await check(dir, { strict: true });
    expect(strict.infos).toHaveLength(1);
    expect(strict.problems).toEqual([]);
  });
});
