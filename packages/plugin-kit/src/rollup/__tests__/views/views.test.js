import { afterEach, describe, expect, test } from "bun:test";
import { build, buildError, cleanup, exists, MAIN, makePlugin, read } from "./helpers.js";
import { scanViews } from "../../views.js";

afterEach(cleanup);

const HELLO = `<script module>
  export const view = { path: "/hello" };
</script>
<h1>Hello</h1>
`;

const CARD = `<script module>
  export const view = {
    contract: 2,
    block: true,
    slot: ["demo:shelf", "other:shelf"],
    sidebar: "profile",
    id: "demo-card",
    priority: 5,
    home: { label: "Card home" },
  };
</script>
<script>
  import Price from "./Price.svelte";
  import { t } from "svelte-i18n";

  /** @type {{ product: Product, settings?: any, size: number }} */
  let { product, settings, size = 3, ...rest } = $props();
</script>
<Price {product} />
<PluginSlot id="demo:card:footer" props={{ product }} />
{#if product}
  <div><PluginSlot id={"demo:card:aside"} /></div>
{/if}
<Hook name="demo:card:top" />
`;

const PRICE = `<script>
  /** @type {number} */
  export let amount;
  /** @type {string} */
  export let currency = "USD";
  export let note;
</script>
<span>{amount}{currency}</span>
`;

const fixture = (extra = {}) =>
  makePlugin({
    "src/main.js": MAIN,
    "src/theme/views/HelloPage.svelte": HELLO,
    "src/theme/views/ProductCard.svelte": CARD,
    "src/theme/views/Price.svelte": PRICE,
    ...extra,
  });

describe("panoViews registration", () => {
  test("one file is one view with its page, in pano:views and views.json", async () => {
    const root = makePlugin({ "src/main.js": MAIN, "src/theme/views/HelloPage.svelte": HELLO });
    const { code } = await build(root);

    expect(code).toContain('"name": "demo:HelloPage"');
    expect(code).toContain('"pluginId": "pano-plugin-demo"');
    expect(code).toContain('"path":"/hello"');

    const json = JSON.parse(read(root, "out/contract/views.json"));

    expect(json).toEqual({
      namespace: "demo",
      pluginId: "pano-plugin-demo",
      version: "1.2.3",
      sdk: 2,
      views: {
        "demo:HelloPage": {
          kind: "page",
          contract: 1,
          source: "src/views/HelloPage.svelte",
          props: {},
          uses: [],
          slots: [],
          hooks: [],
          block: false,
          inject: null,
          page: { path: "/hello" },
          home: null,
          widget: null,
        },
      },
    });
    expect(read(root, "out/contract/src/views/HelloPage.svelte")).toBe(HELLO);
  });

  test("a view with widget gets block: true in its record (doc 06 section 3.1)", async () => {
    const root = makePlugin({
      "src/main.js": MAIN,
      "src/theme/views/GoalWidget.svelte": `<script module>\n  export const view = { widget: true };\n</script>\n<p>goal</p>\n`,
      "src/theme/views/TaggedWidget.svelte": `<script module>\n  export const view = { widget: { tag: "pano-demo-tagged" } };\n</script>\n<p>tagged</p>\n`,
      "src/theme/views/OffWidget.svelte": `<script module>\n  export const view = { widget: false };\n</script>\n<p>off</p>\n`,
    });

    await build(root);

    const { views } = JSON.parse(read(root, "out/contract/views.json"));

    expect(views["demo:GoalWidget"].block).toBe(true);
    expect(views["demo:GoalWidget"].widget).toBe(true);
    expect(views["demo:TaggedWidget"].block).toBe(true);
    expect(views["demo:OffWidget"].block).toBe(false);
  });

  test("props, uses, slots, hooks, injections and home are read without running the file", async () => {
    const root = fixture();

    await build(root);

    const { views } = JSON.parse(read(root, "out/contract/views.json"));

    expect(views["demo:ProductCard"]).toEqual({
      kind: "component",
      contract: 2,
      source: "src/views/ProductCard.svelte",
      props: {
        product: { type: "Product", required: true },
        settings: { type: "any", required: false },
        size: { type: "number", required: false },
      },
      uses: ["demo:Price"],
      slots: ["demo:card:aside", "demo:card:footer"],
      hooks: ["demo:card:top"],
      block: true,
      inject: [
        { slot: "demo:shelf", id: "demo-card", priority: 5 },
        { slot: "other:shelf", id: "demo-card", priority: 5 },
        { sidebar: "profile", id: "demo-card", priority: 5 },
      ],
      page: null,
      home: { label: "Card home" },
      widget: null,
    });
    expect(views["demo:Price"].props).toEqual({
      amount: { type: "number", required: true },
      currency: { type: "string", required: false },
      note: { type: "any", required: true },
    });
  });

  test("pano:views holds a lazy component for every view, sorted, with the owner id", async () => {
    const root = fixture();
    const { code } = await build(root);

    expect(code).toMatch(/"component": \(\) => import\(/);
    expect(code.indexOf("demo:HelloPage")).toBeLessThan(code.indexOf("demo:Price"));
    expect(code.indexOf("demo:Price")).toBeLessThan(code.indexOf("demo:ProductCard"));
    expect(code.match(/"pluginId": "pano-plugin-demo"/g)).toHaveLength(3);
  });

  test("a bare file with no export const view is a component", async () => {
    const root = makePlugin({ "src/main.js": MAIN, "src/theme/views/Plain.svelte": "<p>x</p>" });
    const scan = await scanViews({ dirs: ["src/theme/views"], namespace: "demo", pluginId: "pano-plugin-demo", root });

    expect(scan.views.get("Plain").record.kind).toBe("component");
    expect(scan.views.get("Plain").record.contract).toBe(1);
  });
});

describe("panoViews proxies", () => {
  test("an import of a view file becomes a proxy, the registry keeps the raw component", async () => {
    const root = fixture({
      "src/main.js": `import views from "pano:views";\nimport Card from "./theme/views/ProductCard.svelte";\nexport { Card };\nexport default views;\n`,
    });
    const { code } = await build(root);

    expect(code).toContain('createViewProxy("demo:ProductCard"');
    // the card imports Price, which is proxied too
    expect(code).toContain('createViewProxy("demo:Price"');
    // pano:views imports the raw files: HelloPage has no importer but the registry and no proxy
    expect(code).not.toContain('createViewProxy("demo:HelloPage"');
  });

  test("the proxy re-exports the named exports of the view and its default", async () => {
    const root = fixture({
      "src/main.js": `import Hello, { view } from "./theme/views/HelloPage.svelte";\nexport { Hello, view };\n`,
    });
    const { code } = await build(root);

    expect(code).toContain('createViewProxy("demo:HelloPage"');
    expect(code).toContain("view = ");
  });

  test("files that are not views stay as they are", async () => {
    const root = fixture({
      "src/Other.svelte": "<p>other</p>",
      "src/main.js": `import Other from "./Other.svelte";\nexport default Other;\n`,
    });
    const { code } = await build(root);

    expect(code).not.toContain("createViewProxy(");
  });
});

describe("panoViews contract files", () => {
  test("every view is copied to contract/src, after transformSource", async () => {
    const root = fixture();
    const seen = [];

    await build(root, {
      transformSource: (source, ctx) => {
        seen.push(ctx.view);

        return `<!-- ${ctx.ns}:${ctx.view} -->\n${source}`;
      },
    });

    expect(seen.sort()).toEqual(["HelloPage", "Price", "ProductCard"]);
    expect(read(root, "out/contract/src/views/Price.svelte")).toBe(`<!-- demo:Price -->\n${PRICE}`);
    // the lock and views.json are built from the original, not the transformed text
    expect(JSON.parse(read(root, "out/contract/views.json")).views["demo:Price"].props.amount.required).toBe(true);
  });

  test("the folder layout under src/theme is kept and a removed view leaves no stale copy", async () => {
    const root = makePlugin({
      "src/main.js": MAIN,
      "src/theme/pages/Home.svelte": "<p>h</p>",
      "src/theme/components/store/Badge.svelte": "<p>b</p>",
    });

    await build(root, { dirs: ["src/theme/pages", "src/theme/components"] });

    expect(exists(root, "out/contract/src/pages/Home.svelte")).toBe(true);
    expect(exists(root, "out/contract/src/components/store/Badge.svelte")).toBe(true);

    const views = JSON.parse(read(root, "out/contract/views.json")).views;

    expect(views["demo:Badge"].source).toBe("src/components/store/Badge.svelte");

    // delete one file and rebuild
    const fs = await import("node:fs");

    fs.rmSync(`${root}/src/theme/components/store/Badge.svelte`);
    await build(root, { dirs: ["src/theme/pages", "src/theme/components"] });

    expect(exists(root, "out/contract/src/components/store/Badge.svelte")).toBe(false);
    expect(exists(root, "out/contract/src/pages/Home.svelte")).toBe(true);
  });

  test("a missing view folder is a warning, not an error", async () => {
    const root = makePlugin({ "src/main.js": MAIN });
    const { logs } = await build(root);

    expect(logs.join("\n")).toContain("view folder src/theme/views does not exist");
  });

  test("an unknown key in export const view is a warning", async () => {
    const root = makePlugin({
      "src/main.js": MAIN,
      "src/theme/views/A.svelte": `<script module>export const view = { pth: "/a" };</script>`,
    });
    const { logs } = await build(root);

    expect(logs.join("\n")).toContain('unknown key "pth"');
  });
});

describe("panoViews errors name file, line and fix", () => {
  test("duplicate basename", async () => {
    const root = makePlugin({
      "src/main.js": MAIN,
      "src/theme/pages/Card.svelte": "<p/>",
      "src/theme/components/Card.svelte": "<p/>",
    });
    const error = await buildError(root, { dirs: ["src/theme/pages", "src/theme/components"] });

    expect(error.message).toBe(
      'src/theme/components/Card.svelte:1 view name "Card" is already used by src/theme/pages/Card.svelte — the file name is the view name, so rename one of the two files',
    );
  });

  test("non-literal view", async () => {
    const root = makePlugin({
      "src/main.js": MAIN,
      "src/theme/views/A.svelte": `<script module>\n  const p = "/a";\n  export const view = { path: p };\n</script>`,
    });
    const error = await buildError(root);

    expect(error.message).toContain("src/theme/views/A.svelte:3 export const view is not a literal (view.path)");
    expect(error.message).toContain("move computed values elsewhere");
  });

  test("a view that is not an object literal", async () => {
    const root = makePlugin({
      "src/main.js": MAIN,
      "src/theme/views/A.svelte": `<script module>\n  export const view = makeView();\n</script>`,
    });
    const error = await buildError(root);

    expect(error.message).toContain("src/theme/views/A.svelte:2 export const view must be an object literal");
  });

  test("a call nested in the view names the key", async () => {
    const root = makePlugin({
      "src/main.js": MAIN,
      "src/theme/views/A.svelte": `<script module>\n  export const view = { home: { label: t("x") } };\n</script>`,
    });
    const error = await buildError(root);

    expect(error.message).toContain("export const view is not a literal (view.home.label)");
  });

  test("reserved namespace", async () => {
    const root = makePlugin({ "src/main.js": MAIN, "src/theme/views/A.svelte": "<p/>" });
    const error = await buildError(root, { namespace: "core" });

    expect(error.message).toContain('namespace "core" of pano-plugin-demo is reserved');
    expect(error.message).toContain("set another one with namespace in pano.plugin.js");
  });

  test("slot id outside the own namespace", async () => {
    const root = makePlugin({
      "src/main.js": MAIN,
      "src/theme/views/Checkout.svelte": `<div>\n<PluginSlot id="shop:pay" />\n</div>`,
    });
    const error = await buildError(root);

    expect(error.message).toContain('src/theme/views/Checkout.svelte:2 <PluginSlot id="shop:pay"> is outside this plugin\'s namespace');
    expect(error.message).toContain('rename it to "demo:pay"');
  });

  test("non-literal PluginSlot id", async () => {
    const root = makePlugin({
      "src/main.js": MAIN,
      "src/theme/views/Checkout.svelte": `<script>let id = "demo:x";</script>\n<PluginSlot {id} />`,
    });
    const error = await buildError(root);

    expect(error.message).toContain("src/theme/views/Checkout.svelte:2 <PluginSlot> needs a literal id");
  });

  test("PluginSlot id from an expression of a variable", async () => {
    const root = makePlugin({
      "src/main.js": MAIN,
      "src/theme/views/Checkout.svelte": `<script>let id = "demo:x";</script>\n<PluginSlot id={id} />`,
    });
    const error = await buildError(root);

    expect(error.message).toContain("<PluginSlot> needs a literal id");
  });

  test("view literal in a js file naming no view", async () => {
    const root = makePlugin({
      "src/main.js": MAIN,
      "src/theme/register.js": `export default [\n  { id: "x", view: "demo:Ghost" },\n];\n`,
      "src/theme/views/A.svelte": "<p/>",
    });
    const error = await buildError(root);

    expect(error.message).toBe(
      'src/theme/register.js:2 view: "demo:Ghost" names no view of this plugin — create Ghost.svelte in a view folder, or fix the name',
    );
  });

  test("a literal naming a view of another plugin is left alone", async () => {
    const root = makePlugin({
      "src/main.js": MAIN,
      "src/theme/register.js": `export default [{ view: "other:Thing" }, { view: "demo:A" }];\n`,
      "src/theme/views/A.svelte": "<p/>",
    });

    await build(root);
  });

  test("a view file name that is not a view name", async () => {
    const root = makePlugin({ "src/main.js": MAIN, "src/theme/views/product-card.svelte": "<p/>" });
    const error = await buildError(root);

    expect(error.message).toContain("src/theme/views/product-card.svelte:1 view file names must start with an uppercase letter");
    expect(error.message).toContain("rename it, for example to ProductCard.svelte");
  });

  test("a syntax error in a view names the file", async () => {
    const root = makePlugin({ "src/main.js": MAIN, "src/theme/views/A.svelte": "<script>\n  let = ;\n</script>" });
    const error = await buildError(root);

    expect(error.message).toContain("src/theme/views/A.svelte:");
  });
});

describe("panoViews lock", () => {
  const lockOf = (root) => JSON.parse(read(root, "pano-plugin.lock.json"));

  test("a build writes the views section; props and slots are recorded", async () => {
    const root = fixture();

    await build(root);

    const lock = lockOf(root);

    expect(lock.format).toBe(1);
    expect(lock.views["demo:ProductCard"]).toEqual({
      contract: 2,
      props: { product: { required: true }, settings: { required: false }, size: { required: false } },
      slots: ["demo:card:aside", "demo:card:footer"],
      hooks: ["demo:card:top"],
    });
  });

  test("removing a prop without raising contract fails the build with the exact message", async () => {
    const root = fixture();

    await build(root);

    const fs = await import("node:fs");

    fs.writeFileSync(
      `${root}/src/theme/views/ProductCard.svelte`,
      CARD.replace("let { product, settings, size = 3, ...rest }", "let { product, size = 3, ...rest }").replace("contract: 2,", "contract: 2,"),
    );

    const error = await buildError(root);

    expect(error.message).toBe(
      'demo:ProductCard: prop "settings" removed — set contract: 3 in ProductCard.svelte (never published? delete pano-plugin.lock.json)',
    );
  });

  test("the same change in a watch build is one warning and the lock stays", async () => {
    const root = fixture();

    await build(root);

    const before = read(root, "pano-plugin.lock.json");
    const fs = await import("node:fs");

    fs.writeFileSync(`${root}/src/theme/views/ProductCard.svelte`, CARD.replace("settings, ", ""));

    const { logs } = await build(root, { watch: true });

    expect(logs.filter((line) => line.startsWith("demo:"))).toEqual([
      'demo:ProductCard: prop "settings" removed — set contract: 3 in ProductCard.svelte (never published? delete pano-plugin.lock.json)',
    ]);
    expect(read(root, "pano-plugin.lock.json")).toBe(before);
  });

  test("raising the contract passes and rewrites the lock", async () => {
    const root = fixture();

    await build(root);

    const fs = await import("node:fs");

    fs.writeFileSync(`${root}/src/theme/views/ProductCard.svelte`, CARD.replace("settings, ", "").replace("contract: 2", "contract: 3"));
    await build(root);

    expect(lockOf(root).views["demo:ProductCard"].contract).toBe(3);
    expect(lockOf(root).views["demo:ProductCard"].props.settings).toBeUndefined();
  });

  test("a new required prop, and changed slots, need a raised contract", async () => {
    const root = fixture();

    await build(root);

    const fs = await import("node:fs");

    fs.writeFileSync(`${root}/src/theme/views/ProductCard.svelte`, CARD.replace("size = 3", "size, label"));

    expect((await buildError(root)).message).toBe(
      'demo:ProductCard: required prop "label" added — set contract: 3 in ProductCard.svelte (never published? delete pano-plugin.lock.json)',
    );

    fs.writeFileSync(`${root}/src/theme/views/ProductCard.svelte`, CARD.replace('<PluginSlot id="demo:card:footer" props={{ product }} />', ""));

    expect((await buildError(root)).message).toContain("demo:ProductCard: slots changed — set contract: 3");
  });

  test("a new optional prop and a new view only update the lock", async () => {
    const root = fixture();

    await build(root);

    const fs = await import("node:fs");

    fs.writeFileSync(`${root}/src/theme/views/ProductCard.svelte`, CARD.replace("size = 3", "size = 3, badge = null"));
    fs.writeFileSync(`${root}/src/theme/views/Extra.svelte`, "<p/>");
    await build(root);

    expect(lockOf(root).views["demo:ProductCard"].props.badge).toEqual({ required: false });
    expect(lockOf(root).views["demo:Extra"]).toBeDefined();
  });

  test("classes written by the style step survive a rewrite", async () => {
    const root = fixture();

    await build(root);

    const fs = await import("node:fs");
    const lock = lockOf(root);

    lock.views["demo:Price"].classes = ["demo-price"];
    fs.writeFileSync(`${root}/pano-plugin.lock.json`, JSON.stringify(lock));
    fs.writeFileSync(`${root}/src/theme/views/Price.svelte`, PRICE.replace("export let note;", "export let note;\n  export let extra = 1;"));
    await build(root);

    expect(lockOf(root).views["demo:Price"].classes).toEqual(["demo-price"]);
    expect(lockOf(root).views["demo:Price"].props.extra).toEqual({ required: false });
  });

  test("lock: false leaves the lock file alone", async () => {
    const root = fixture();

    await build(root, { lock: false });

    expect(exists(root, "pano-plugin.lock.json")).toBe(false);
  });

  test("a corrupt lock file fails with the fix", async () => {
    const root = fixture({ "pano-plugin.lock.json": "{nope" });
    const error = await buildError(root);

    expect(error.message).toContain("pano-plugin.lock.json is not valid JSON");
  });
});
