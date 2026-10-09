import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { entryFile, renderThemeMetaModule, scanSource, scanThemeMeta } from "../theme-meta.js";
import { panoThemeMeta } from "../vite-config.js";

const roots = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** @param {Record<string, string>} files  theme-relative path -> content */
function makeTheme(files) {
  const dir = mkdtempSync(join(tmpdir(), "theme-meta-"));
  roots.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const file = join(dir, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return dir;
}

const thunk = (file) => new Function(`return () => import("${file}")`)();

describe("scanSource", () => {
  test("reads literal attributes of a block and leaves the rest out", () => {
    const { refs } = scanSource(
      `<PluginBlock id="market:ProductGrid" limit={8} category="vip" featured big ratio={1.5} off={false} onclick={go} {...rest} {shorthand} label="a {b}" />`,
      true,
    );
    expect(refs).toEqual([
      { id: "market:ProductGrid", props: { limit: 8, category: "vip", featured: true, big: true, ratio: 1.5, off: false } },
    ]);
  });

  test("accepts single quotes, a braced string id and a '>' inside an expression", () => {
    const { refs } = scanSource(
      `<PluginBlock id={'a:One'} count={items.length > 2 ? 3 : 4} size='s' />\n<PluginBlock\n  id='a:Two'\n  limit={-1}\n>x</PluginBlock>`,
      true,
    );
    expect(refs).toEqual([
      { id: "a:One", props: { size: "s" } },
      { id: "a:Two", props: { limit: -1 } },
    ]);
  });

  test("a dynamic id is skipped", () => {
    const { refs } = scanSource(`<PluginBlock id={name} /> <PluginBlock id="a:{x}" /> <PluginBlock {id} />`, true);
    expect(refs).toEqual([]);
  });

  test("finds slots and pluginView calls, in script and in markup expressions", () => {
    const { refs } = scanSource(
      `<script>\n  import { pluginView } from "$pano/registry/view.js";\n  const Price = pluginView("market:PriceTag");\n  const Other = pluginView('market:Other', x);\n</script>\n` +
        `<PluginSlot id="market:checkout:payment" props={{ order }} filter={(item) => item.id === method} />\n` +
        `{@const C = pluginView(\`market:Tpl\`)}`,
      true,
    );
    expect(refs.map((r) => r.id).sort()).toEqual([
      "market:Other",
      "market:PriceTag",
      "market:Tpl",
      "market:checkout:payment",
    ]);
    expect(refs.find((r) => r.id === "market:checkout:payment").props).toEqual({});
  });

  test("ignores comments and a pluginView with a dynamic argument", () => {
    const { refs } = scanSource(
      `<!-- <PluginBlock id="a:Commented" /> -->\n<script>\n  // pluginView("a:Line")\n  /* pluginView("a:Block") */\n  const X = pluginView(name);\n  const Y = pluginView(\`a:\${n}\`);\n</script>\n<PluginBlock id="a:Real" />`,
      true,
    );
    expect(refs).toEqual([{ id: "a:Real", props: {} }]);
  });

  test("collects static and dynamic imports", () => {
    const { imports } = scanSource(
      `<script module>\n  export const view = {};\n</script>\n<script>\n  import A from "./A.svelte";\n  import { b } from '$lib/b.js';\n  import "./side.js";\n  export { c } from "../c.js";\n  const D = () => import("./D.svelte");\n</script>`,
      true,
    );
    expect(imports.sort()).toEqual(["$lib/b.js", "../c.js", "./A.svelte", "./D.svelte", "./side.js"]);
  });
});

describe("entryFile", () => {
  test("reads a thunk, an object entry and a string without calling anything", () => {
    expect(entryFile(thunk("./src/views/Navbar.svelte"))).toBe("./src/views/Navbar.svelte");
    expect(entryFile({ contract: 2, component: thunk("./src/views/market/Card.svelte") })).toBe("./src/views/market/Card.svelte");
    expect(entryFile("./src/pages/Staff.svelte")).toBe("./src/pages/Staff.svelte");
    expect(entryFile({})).toBeNull();
    expect(entryFile(undefined)).toBeNull();
  });
});

describe("scanThemeMeta", () => {
  const files = {
    "src/views/Navbar.svelte": `<script>\n  import Cart from "./parts/CartSlot.svelte";\n  import { helper } from "$lib/helper.js";\n  import Pkg from "some-package";\n</script>\n<Cart />\n<PluginBlock id="market:NavCart" />`,
    "src/views/parts/CartSlot.svelte": `<script>\n  import Deep from "../../lib/Deep.svelte";\n  import Back from "../Navbar.svelte";\n</script>\n<PluginBlock id="market:Mini" size="s" /><Deep />`,
    "src/lib/Deep.svelte": `<PluginSlot id="market:checkout:payment" />`,
    "src/lib/helper.js": `import { pluginView } from "$pano/registry/view.js";\nexport const Tag = pluginView("market:PriceTag");\n`,
    "src/views/market/ProductCard.svelte": `<PluginBlock id="market:ProductCard" /><PluginBlock id="market:PriceTag" />`,
    "src/views/Footer.svelte": `<p>no placements</p>`,
    "src/pages/Staff.svelte": `<PluginBlock id="market:ProductGrid" limit={8} />`,
    "src/pages/Landing.svelte": `<script>\n  import Hero from "$lib/Hero.svelte";\n</script>\n<Hero />`,
    "src/lib/Hero.svelte": `<PluginBlock id="market:ProductGrid" limit={3} /><PluginBlock id="market:ProductGrid" limit={3} />`,
    "src/lib/Unrelated.svelte": `<PluginBlock id="market:Unrelated" />`,
  };
  const dir = makeTheme(files);
  const config = {
    views: {
      Navbar: thunk("./src/views/Navbar.svelte"),
      "market:ProductCard": { contract: 2, component: thunk("./src/views/market/ProductCard.svelte") },
      Footer: thunk("./src/views/Footer.svelte"),
    },
    routes: { add: { "/staff-team": "./src/pages/Staff.svelte" } },
    home: {
      default: "landing",
      options: {
        posts: { label: "Posts" },
        landing: { label: "Landing", page: "./src/pages/Landing.svelte" },
        store: { label: "Store", path: "/store" },
      },
    },
  };

  test("collects the refs of every override, route page and home page, through imports", () => {
    const meta = scanThemeMeta({ themeDir: dir, config });

    expect(Object.keys(meta.refs).sort()).toEqual(["Footer", "Navbar", "home:landing", "market:ProductCard", "route:/staff-team"]);
    expect(meta.refs.Navbar.map((r) => r.id).sort()).toEqual([
      "market:Mini",
      "market:NavCart",
      "market:PriceTag",
      "market:checkout:payment",
    ]);
    expect(meta.refs.Navbar.find((r) => r.id === "market:Mini").props).toEqual({ size: "s" });
    expect(meta.refs.Footer).toEqual([]);
    expect(meta.refs["route:/staff-team"]).toEqual([{ id: "market:ProductGrid", props: { limit: 8 } }]);
    // two identical placements are one ref
    expect(meta.refs["home:landing"]).toEqual([{ id: "market:ProductGrid", props: { limit: 3 } }]);
  });

  test("keeps different props as different refs", () => {
    const d = makeTheme({
      "src/views/A.svelte": `<PluginBlock id="m:Grid" limit={4} /><PluginBlock id="m:Grid" limit={8} /><PluginBlock limit={4} id="m:Grid" />`,
    });
    const meta = scanThemeMeta({ themeDir: d, config: { views: { A: thunk("./src/views/A.svelte") } } });
    expect(meta.refs.A.map((r) => r.props.limit)).toEqual([4, 8]);
  });

  test("claims = found ids except the override's own name; files that nothing imports are not read", () => {
    const meta = scanThemeMeta({ themeDir: dir, config });
    expect(meta.claims).toEqual([
      "market:Mini",
      "market:NavCart",
      "market:PriceTag",
      "market:ProductGrid",
      "market:checkout:payment",
    ]);
    expect(meta.files.some((f) => f.endsWith("Unrelated.svelte"))).toBe(false);
    expect(meta.files.some((f) => f.endsWith("helper.js"))).toBe(true);
  });

  test("an override's own name is not a claim, but another override's is", () => {
    const d = makeTheme({
      "src/views/Card.svelte": `<PluginBlock id="m:Card" /><PluginBlock id="m:Other" />`,
      "src/views/Other.svelte": `<p />`,
    });
    const meta = scanThemeMeta({
      themeDir: d,
      config: { views: { "m:Card": thunk("./src/views/Card.svelte"), "m:Other": thunk("./src/views/Other.svelte") } },
    });
    expect(meta.claims).toEqual(["m:Other"]);
  });

  test("config claims merge in; an explicit entry wins over the scan", () => {
    const meta = scanThemeMeta({
      themeDir: dir,
      config: { ...config, claims: { "market:NavCart": false, "market:Extra": true, "market:Off": false } },
    });
    expect(meta.claims).toContain("market:Extra");
    expect(meta.claims).not.toContain("market:NavCart");
    expect(meta.claims).not.toContain("market:Off");
    expect(meta.claims).toContain("market:Mini");
  });

  test("homePages maps an option id to its page, options without a page are left out", () => {
    const meta = scanThemeMeta({ themeDir: dir, config });
    expect(meta.homePages).toEqual({ landing: "./src/pages/Landing.svelte" });
  });

  test("a missing file, an empty config and an import cycle do not throw", () => {
    expect(scanThemeMeta({ themeDir: dir, config: {} })).toEqual({ refs: {}, claims: [], homePages: {}, files: [] });
    expect(scanThemeMeta({ themeDir: dir })).toEqual({ refs: {}, claims: [], homePages: {}, files: [] });
    const meta = scanThemeMeta({ themeDir: dir, config: { views: { Gone: thunk("./src/views/Gone.svelte") } } });
    expect(meta.refs.Gone).toEqual([]);
    // Navbar -> CartSlot -> Navbar is a cycle in the fixture above and still finishes
    expect(scanThemeMeta({ themeDir: dir, config }).refs.Navbar.length).toBe(4);
  });

  test("imports that leave the theme or live in node_modules are not followed", () => {
    const d = makeTheme({
      "src/views/A.svelte": `<script>\n  import X from "../../../outside.svelte";\n  import Y from "../../node_modules/pkg/Y.svelte";\n</script>\n<PluginBlock id="m:A" />`,
      "node_modules/pkg/Y.svelte": `<PluginBlock id="m:FromModules" />`,
    });
    const meta = scanThemeMeta({ themeDir: d, config: { views: { Z: thunk("./src/views/A.svelte") } } });
    expect(meta.refs.Z.map((r) => r.id)).toEqual(["m:A"]);
  });
});

describe("virtual module", () => {
  test("renderThemeMetaModule emits data and lazy home pages", async () => {
    const d = makeTheme({ "src/pages/Landing.svelte": "<p />" });
    const meta = { refs: { Navbar: [{ id: "a:B", props: { n: 1 } }] }, claims: ["a:B"], homePages: { landing: "./src/pages/Landing.svelte" }, files: [] };
    const source = renderThemeMetaModule(meta, d);
    expect(source).toContain(`export const refs = {"Navbar":[{"id":"a:B","props":{"n":1}}]};`);
    expect(source).toContain(`export const claims = ["a:B"];`);
    expect(source).toContain(`"landing": () => import(${JSON.stringify(join(d, "src/pages/Landing.svelte"))})`);
    expect(renderThemeMetaModule({ refs: {}, claims: [], homePages: {}, files: [] }, d)).toContain("export const homePages = {};");
  });

  test("panoThemeMeta resolves the id and serves a scan of the theme", async () => {
    const d = makeTheme({
      "theme.config.js": `export default { views: { Navbar: () => import("./src/views/Navbar.svelte") }, claims: { "a:Keep": true } };\n`,
      "src/views/Navbar.svelte": `<PluginBlock id="a:Cart" n={2} />`,
    });
    const plugin = panoThemeMeta({ themeDir: d });
    expect(plugin.name).toBe("pano-theme-meta");
    expect(plugin.resolveId("virtual:pano-theme-meta")).toBe("\0virtual:pano-theme-meta");
    expect(plugin.resolveId("something-else")).toBeNull();

    const watched = [];
    const code = await plugin.load.call({ addWatchFile: (f) => watched.push(f) }, "\0virtual:pano-theme-meta");
    expect(code).toContain(`"Navbar":[{"id":"a:Cart","props":{"n":2}}]`);
    expect(code).toContain(`export const claims = ["a:Cart","a:Keep"];`);
    expect(watched).toContain(join(d, "theme.config.js"));
    expect(watched).toContain(join(d, "src/views/Navbar.svelte"));
    expect(await plugin.load.call({}, "other")).toBeNull();
  });

  test("panoThemeMeta without a theme.config.js serves an empty meta", async () => {
    const d = makeTheme({ "package.json": "{}" });
    const code = await panoThemeMeta({ themeDir: d }).load.call({}, "\0virtual:pano-theme-meta");
    expect(code).toContain("export const refs = {};");
    expect(code).toContain("export const claims = [];");
  });
});
