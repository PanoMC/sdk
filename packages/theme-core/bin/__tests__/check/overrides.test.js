import { describe, expect, test } from "bun:test";
import { readOverrides } from "../../check.js";
import { at, check, engineView, makeTheme } from "./helpers.js";

const card = (extra = "") =>
  `<script>\n  let { product } = $props();\n${extra}</script>\n<div class="market-product-card">{product.name}</div>\n`;
const config = (entries, rest = "") => `export default { ${rest} views: { ${entries} } };\n`;
const CARD_ENTRY = `"market:ProductCard": { contract: 2, component: () => import("./src/views/market/ProductCard.svelte") }`;
const cardTheme = (text = card(), entry = CARD_ENTRY) =>
  makeTheme({ snapshot: true, config: config(entry), files: { "src/views/market/ProductCard.svelte": text } });

describe("readOverrides: one regex, both forms, quoted keys", () => {
  test("function form, object form, quoted and alias keys, comments ignored", () => {
    const list = readOverrides(`
      // Navbar: () => import("./commented.svelte"),
      export default { views: {
        Navbar: () => import("./src/views/Navbar.svelte"),
        'pano-plugin-market:NavCart': { contract: 3, controllers: ["market/cart", 'market/format'],
          component: () => import("./src/views/NavCart.svelte") },
        "market:ProductCard": { component: () => import("./src/views/ProductCard.svelte") },
      }, home: { options: { landing: { label: "Landing", page: "./x.svelte" } } } };`);
    expect(list.map((o) => [o.key, o.path, o.contract, o.controllers])).toEqual([
      ["Navbar", "./src/views/Navbar.svelte", 1, []],
      ["pano-plugin-market:NavCart", "./src/views/NavCart.svelte", 3, ["market/cart", "market/format"]],
      ["market:ProductCard", "./src/views/ProductCard.svelte", 1, []],
    ]);
  });

  test("no views block, nothing found", () => {
    expect(readOverrides("export default { provides: { bootstrap: false } };")).toEqual([]);
  });
});

describe("C1 override file exists", () => {
  test("error ending with the path", async () => {
    const dir = makeTheme({ config: config(`Navbar: () => import("./src/views/Navbar.svelte")`) });
    const msg = at(await check(dir), "error", "C1");
    expect(msg).toHaveLength(1);
    expect(msg[0]).toEndWith("./src/views/Navbar.svelte");
  });

  test("object form entries are read too", async () => {
    const dir = makeTheme({ snapshot: true, config: config(CARD_ENTRY) });
    expect(at(await check(dir), "error", "C1")).toHaveLength(1);
  });

  test("control: the file exists", async () => {
    expect(at(await check(cardTheme()), "error", "C1")).toEqual([]);
  });
});

describe("C2 name is known", () => {
  test("engine: unknown name is an error", async () => {
    const dir = makeTheme({
      config: config(`HomeViw: () => import("./src/views/HomeViw.svelte")`),
      files: { "src/views/HomeViw.svelte": "<div></div>" },
    });
    const msg = at(await check(dir), "error", "C2");
    expect(msg).toHaveLength(1);
    expect(msg[0]).toContain("HomeViw");
  });

  test("engine: a known view and a registry component pass", async () => {
    const dir = makeTheme({
      config: config(`Pagination: () => import("./src/views/Pagination.svelte")`),
      files: { "src/views/Pagination.svelte": "<div></div>" },
    });
    expect(at(await check(dir), "error", "C2")).toEqual([]);
  });

  test("plugin: name not in the snapshot is an error ending with the pull command", async () => {
    const dir = makeTheme({
      snapshot: true,
      config: config(`"market:Nope": () => import("./src/views/Nope.svelte")`),
      files: { "src/views/Nope.svelte": "<div></div>" },
    });
    const msg = at(await check(dir), "error", "C2");
    expect(msg).toHaveLength(1);
    expect(msg[0]).toEndWith("run: theme-core contracts pull");
  });

  test("plugin: no snapshot for the namespace is a warning, not an error", async () => {
    const dir = makeTheme({
      config: config(`"market:ProductCard": () => import("./src/views/P.svelte")`),
      files: { "src/views/P.svelte": "<div></div>" },
    });
    const report = await check(dir);
    expect(at(report, "error", "C2")).toEqual([]);
    const msg = at(report, "warning", "C2");
    expect(msg).toHaveLength(1);
    expect(msg[0]).toEndWith("run: theme-core contracts pull");
  });

  test("plugin: the plugin id is accepted as an alias of the namespace", async () => {
    const dir = cardTheme(card(), `"pano-plugin-market:ProductCard": { contract: 2, component: () => import("./src/views/market/ProductCard.svelte") }`);
    const report = await check(dir);
    expect(at(report, "error")).toEqual([]);
    expect(at(report, "warning")).toEqual([]);
  });
});

describe("C3 contract equals the snapshot", () => {
  test("plugin: an older contract is a warning with the update steps", async () => {
    const dir = cardTheme(card(), CARD_ENTRY.replace("contract: 2", "contract: 1"));
    const msg = at(await check(dir), "warning", "C3");
    expect(msg).toHaveLength(1);
    expect(msg[0]).toEndWith(
      "shows the default view until updated; run: theme-core eject-view market:ProductCard, merge <file>.new, then: theme-core accept market:ProductCard",
    );
  });

  test("plugin: the function form means contract 1", async () => {
    const dir = cardTheme(card(), `"market:ProductCard": () => import("./src/views/market/ProductCard.svelte")`);
    expect(at(await check(dir), "warning", "C3")).toHaveLength(1);
  });

  test("engine: a different contract is a warning", async () => {
    const dir = makeTheme({
      config: config(`HomeView: { contract: 5, component: () => import("./src/views/HomeView.svelte") }`),
      files: { "src/views/HomeView.svelte": engineView("HomeView") },
    });
    expect(at(await check(dir), "warning", "C3")).toHaveLength(1);
  });

  test("control: equal contracts pass", async () => {
    expect(at(await check(cardTheme()), "warning", "C3")).toEqual([]);
  });
});

describe("C4 hooks, slots and slotProps of the default are kept", () => {
  const storePage = (body) => `<script>\n  let { data } = $props();\n</script>\n<div class="market-store-page">${body}</div>\n`;
  const entry = `"market:StorePage": () => import("./src/views/market/StorePage.svelte")`;
  const storeTheme = (body) =>
    makeTheme({ snapshot: true, config: config(entry), files: { "src/views/market/StorePage.svelte": storePage(body) } });

  test("plugin: a lost hook and a lost slot are errors ending with the consequence", async () => {
    const msg = at(await check(storeTheme("")), "error", "C4");
    expect(msg).toHaveLength(2);
    for (const m of msg) expect(m).toEndWith("plugins mounting there will disappear");
    expect(msg.join("\n")).toContain("market:store:top");
    expect(msg.join("\n")).toContain("market:store:footer");
  });

  test("plugin: keeping both passes (single or double quotes, expression form)", async () => {
    const dir = storeTheme(`<Hook name='market:store:top' /><PluginSlot id={"market:store:footer"} />`);
    expect(at(await check(dir), "error", "C4")).toEqual([]);
  });

  test("engine: a lost hook of the default view is an error", async () => {
    const dir = makeTheme({
      config: config(`HomeView: () => import("./src/views/HomeView.svelte")`),
      files: { "src/views/HomeView.svelte": "<div></div>" },
    });
    const msg = at(await check(dir), "error", "C4");
    expect(msg).toHaveLength(1);
    expect(msg[0]).toContain("page:home:top");
  });

  test("engine: a hook inside an HTML comment does not count", async () => {
    const dir = makeTheme({
      config: config(`HomeView: () => import("./src/views/HomeView.svelte")`),
      files: { "src/views/HomeView.svelte": '<!-- <Hook name="page:home:top" /> -->' },
    });
    expect(at(await check(dir), "error", "C4")).toHaveLength(1);
  });

  test("engine: a lost slotProps identifier is an error", async () => {
    const dir = makeTheme({
      config: config(`PageActions: () => import("./src/views/PageActions.svelte")`),
      files: { "src/views/PageActions.svelte": "<div>{@render left?.()}{@render right?.()}</div>" },
    });
    const msg = at(await check(dir), "error", "C4");
    expect(msg).toHaveLength(1);
    expect(msg[0]).toContain("'middle'");
  });

  test("engine: control, a copy of the default passes", async () => {
    const dir = makeTheme({
      config: config(`HomeView: () => import("./src/views/HomeView.svelte")`),
      files: { "src/views/HomeView.svelte": engineView("HomeView") },
    });
    expect(at(await check(dir), "error", "C4")).toEqual([]);
  });
});

describe("C5 a hook is mounted in one effective view only", () => {
  test("a hook added to MainLayoutView while HomeView mounts it too is an error", async () => {
    const main = engineView("MainLayoutView").replace("<svelte:head>", '<Hook name="page:home:top" />\n<svelte:head>');
    const dir = makeTheme({
      config: config(`MainLayoutView: () => import("./src/views/MainLayoutView.svelte")`),
      files: { "src/views/MainLayoutView.svelte": main },
    });
    const msg = at(await check(dir), "error", "C5");
    expect(msg).toHaveLength(1);
    expect(msg[0]).toContain("page:home:top");
    expect(msg[0]).toContain("HomeView.svelte (default)");
  });

  test("two plugin overrides mounting the same hook is an error", async () => {
    const dir = makeTheme({
      snapshot: true,
      config: config(`"market:StorePage": () => import("./src/views/A.svelte"), "market:ProductGrid": () => import("./src/views/B.svelte")`),
      files: {
        "src/views/A.svelte": '<Hook name="market:store:top" /><PluginSlot id="market:store:footer" />',
        "src/views/B.svelte": '<Hook name="market:store:top" />',
      },
    });
    expect(at(await check(dir), "error", "C5")).toHaveLength(1);
  });

  test("control: moving the hook out of the default view passes", async () => {
    const home = engineView("HomeView");
    const dir = makeTheme({
      config: config(`HomeView: () => import("./src/views/HomeView.svelte")`),
      files: { "src/views/HomeView.svelte": home },
    });
    expect(at(await check(dir), "error", "C5")).toEqual([]);
  });
});

describe("C6 props read by the override are in the contract", () => {
  test("unknown prop names are a warning that lists them", async () => {
    const dir = cardTheme(card().replace("let { product }", "let { product, extra, other = 3, ...rest }"));
    const msg = at(await check(dir), "warning", "C6");
    expect(msg).toHaveLength(1);
    expect(msg[0]).toEndWith("extra, other");
  });

  test("engine views are checked against skin-contract props", async () => {
    const dir = makeTheme({
      config: config(`HomeView: () => import("./src/views/HomeView.svelte")`),
      files: { "src/views/HomeView.svelte": '<script>let { data, nope } = $props();</script><Hook name="page:home:top" />' },
    });
    expect(at(await check(dir), "warning", "C6")[0]).toEndWith("nope");
  });

  test("control: contract props and children pass", async () => {
    const dir = cardTheme(card().replace("let { product }", "let { product, settings, children }"));
    expect(at(await check(dir), "warning", "C6")).toEqual([]);
  });
});

describe("C11 load export and context towards a plugin view", () => {
  test("an exported load is a warning saying it is ignored", async () => {
    for (const form of ["export async function load() { return {}; }", "export const load = () => ({});", "export { load };"]) {
      const dir = cardTheme(`<script module>\n  ${form}\n</script>\n` + card());
      const msg = at(await check(dir), "warning", "C11");
      expect(msg).toHaveLength(1);
      expect(msg[0]).toContain("ignored");
    }
  });

  test("setContext, and getContext of a foreign key, in a plugin override", async () => {
    const dir = cardTheme(card("  import { setContext, getContext } from 'svelte';\n  setContext('cart', 1);\n  getContext('market');\n  getContext('session');\n"));
    const msg = at(await check(dir), "warning", "C11");
    expect(msg).toHaveLength(2);
    expect(msg.join("\n")).toContain("setContext('cart')");
    expect(msg.join("\n")).toContain("getContext('market')");
  });

  test("control: an engine override may use the engine contexts", async () => {
    const dir = makeTheme({
      config: config(`HomeView: () => import("./src/views/HomeView.svelte")`),
      files: { "src/views/HomeView.svelte": engineView("HomeView") },
    });
    expect(at(await check(dir), "warning", "C11")).toEqual([]);
  });
});

describe("C14 the override keeps the view's root class", () => {
  test("a missing root class is a warning naming the class", async () => {
    const dir = cardTheme(card().replace("market-product-card", "my-card"));
    const msg = at(await check(dir), "warning", "C14");
    expect(msg).toHaveLength(1);
    expect(msg[0]).toEndWith("market-product-card");
  });

  test("a part class is not the root class", async () => {
    const dir = cardTheme(card().replace("market-product-card", "market-product-card__title"));
    expect(at(await check(dir), "warning", "C14")).toHaveLength(1);
  });

  test("control: the root class among others passes", async () => {
    const dir = cardTheme(card().replace("market-product-card", "card market-product-card is-x"));
    expect(at(await check(dir), "warning", "C14")).toEqual([]);
  });
});
