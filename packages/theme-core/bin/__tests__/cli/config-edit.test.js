import { describe, expect, test } from "bun:test";
import { addControllerPins, addViewEntry, removeModuleExport, setViewContract, transformViewSource } from "../../contracts.js";

const entry = (over = {}) => ({ contract: 2, controllers: ["market/cart"], file: "./src/views/market/A.svelte", ...over });

/** Evaluates the text as the config module would. */
async function evaluate(text) {
  const url = "data:text/javascript;base64," + Buffer.from(text).toString("base64");
  return (await import(url)).default;
}

describe("addViewEntry", () => {
  test("into an empty one-line views object", async () => {
    const next = addViewEntry("export default { views: {} };\n", "market:A", entry());
    expect(next.status).toBe("added");
    expect((await evaluate(next.text)).views["market:A"].contract).toBe(2);
    expect(next.text).toContain("\n  ");
  });

  test("after a last property without a trailing comma", async () => {
    const text = `export default {\n  views: {\n    Navbar: () => import("./n.svelte")\n  }\n};\n`;
    const next = addViewEntry(text, "market:A", entry());
    const loaded = await evaluate(next.text);
    expect(Object.keys(loaded.views)).toEqual(["Navbar", "market:A"]);
  });

  test("after a last property with a line comment and a trailing comma", async () => {
    const text = `export default {\n  views: {\n    Navbar: () => import("./n.svelte"), // nav\n  },\n};\n`;
    const next = addViewEntry(text, "market:A", entry());
    expect(next.text).toContain(`Navbar: () => import("./n.svelte"), // nav\n`);
    expect(Object.keys((await evaluate(next.text)).views)).toEqual(["Navbar", "market:A"]);
  });

  test("quoted keys, nested braces and strings that contain braces do not confuse the scan", async () => {
    const text = `export default {
  title: "a } b { c",
  views: {
    "market:B": { contract: 1, component: () => import("./b.svelte") },
    'x:y': () => import(\`./{y}.svelte\`),
  },
  routes: { rename: { "/a": "/b" } },
};
`;
    const next = addViewEntry(text, "market:A", entry());
    const loaded = await evaluate(next.text);
    expect(Object.keys(loaded.views)).toEqual(["market:B", "x:y", "market:A"]);
    expect(loaded.title).toBe("a } b { c");
    expect(loaded.routes).toEqual({ rename: { "/a": "/b" } });
  });

  test("the same id twice is left alone, also in quoted form", () => {
    const text = `export default {\n  views: {\n    'market:A': () => import("./a.svelte"),\n  },\n};\n`;
    const next = addViewEntry(text, "market:A", entry());
    expect(next.status).toBe("exists");
    expect(next.text).toBe(text);
  });

  test("a commented-out example does not count as the config", async () => {
    const text = `/**\n * export default { views: {} }\n * views: { Foo: 1 }\n */\nexport default {\n  views: {\n  },\n};\n`;
    const next = addViewEntry(text, "market:A", entry());
    expect(Object.keys((await evaluate(next.text)).views)).toEqual(["market:A"]);
  });

  test("a config exported through a variable", async () => {
    const text = `const config = {\n  views: {},\n};\nexport default config;\n`;
    const next = addViewEntry(text, "market:A", entry());
    expect(Object.keys((await evaluate(next.text)).views)).toEqual(["market:A"]);
  });

  test("an entry without controllers has no controllers line", () => {
    const next = addViewEntry("export default { views: {} };\n", "market:A", entry({ controllers: [] }));
    expect(next.text).not.toContain("controllers");
  });

  test("a config the editor cannot read returns null", () => {
    expect(addViewEntry("export default makeConfig();\n", "market:A", entry())).toBeNull();
    expect(addViewEntry("export default { views: viewTable };\n", "market:A", entry())).toBeNull();
    expect(addViewEntry("", "market:A", entry())).toBeNull();
  });
});

describe("addControllerPins", () => {
  test("creates the map, keeps existing pins, overwrites on request", async () => {
    const created = addControllerPins("export default {\n  views: {},\n};\n", { "market/cart": 3 });
    expect(created.added).toEqual(["market/cart"]);
    expect((await evaluate(created.text)).controllers).toEqual({ "market/cart": 3 });

    const kept = addControllerPins(created.text, { "market/cart": 9, "market/format": 1 });
    expect(kept.added).toEqual(["market/format"]);
    expect((await evaluate(kept.text)).controllers).toEqual({ "market/cart": 3, "market/format": 1 });

    const forced = addControllerPins(kept.text, { "market/cart": 9 }, { overwrite: true });
    expect(forced.changed).toEqual(["market/cart"]);
    expect((await evaluate(forced.text)).controllers["market/cart"]).toBe(9);
  });

  test("no pins is a no-op", () => {
    const text = "export default {};\n";
    expect(addControllerPins(text, {}).text).toBe(text);
  });
});

describe("setViewContract", () => {
  test("replaces the number, reports the controllers and the component file", () => {
    const text = `export default {\n  views: {\n    "market:A": { contract: 1, controllers: ["market/cart", 'market/format'], component: () => import("./src/views/market/A.svelte") },\n  },\n};\n`;
    const next = setViewContract(text, "market:A", 4);
    expect(next.text).toContain("contract: 4,");
    expect(next.controllers).toEqual(["market/cart", "market/format"]);
    expect(next.file).toBe("./src/views/market/A.svelte");
  });

  test("an unknown id is null", () => {
    expect(setViewContract("export default { views: {} };", "market:A", 2)).toBeNull();
    expect(setViewContract("export default {};", "market:A", 2)).toBeNull();
  });
});

describe("removeModuleExport", () => {
  test("variable forms, with and without semicolon, nested braces and strings", () => {
    const code = `
  import x from 'x';
  /** doc */
  export const view = {
    path: '/a;b',
    nested: { deep: ['}', "{"] },
  }
  export let load = async (event) => {
    return { ok: \`}\` };
  };
  export const keep = 1;
`;
    const out = removeModuleExport(removeModuleExport(code, "view"), "load");
    expect(out).toContain("import x from 'x';");
    expect(out).toContain("export const keep = 1;");
    expect(out).not.toContain("view");
    expect(out).not.toContain("load");
    expect(out).not.toContain("doc");
  });

  test("function forms: sync, async, generator-free, with defaults and braces in the signature", () => {
    const code = `export async function load({ fetch }, props = { a: 1 }) {\n  if (props) { return {}; }\n  return { x: '}' };\n}\nexport function other() {}\n`;
    const out = removeModuleExport(code, "load");
    expect(out.trim()).toBe("export function other() {}");
  });

  test("a name that is only a prefix of another export is not removed", () => {
    const code = "export const viewport = 1;\nexport const loader = 2;\n";
    expect(removeModuleExport(removeModuleExport(code, "view"), "load")).toBe(code);
  });

  test("text in comments is not an export", () => {
    const code = "// export const view = 1;\nexport const keep = 1;\n";
    expect(removeModuleExport(code, "view")).toBe(code);
  });
});

describe("transformViewSource", () => {
  const viewsBySource = new Map([
    ["src/c/A.svelte", "p:A"],
    ["src/c/B.svelte", "p:B"],
    ["src/pages/C.svelte", "p:C"],
  ]);

  test("rewrites several view imports, other directories, aliases and keeps non-view imports", () => {
    const source = `<script>
  import B from "./B.svelte";
  import Cc from '../pages/C.svelte'
  import { util } from '../_lib/util.js';
  import deep from '../_lib/deep/index.js';
  import Local from './NotAView.svelte';
  import { t } from 'svelte-i18n';
</script>

<B /><Cc /><Local />
`;
    const out = transformViewSource(source, { sourcePath: "src/c/A.svelte", viewsBySource });

    expect(out.viewImports).toEqual([
      { local: "B", id: "p:B" },
      { local: "Cc", id: "p:C" },
    ]);
    expect(out.helperImports.sort()).toEqual(["_lib/deep/index.js", "_lib/util.js"]);
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toContain("NotAView.svelte");
    expect(out.code).toContain('const B = pluginView("p:B");');
    expect(out.code).toContain('const Cc = pluginView("p:C");');
    expect(out.code).toContain("import Local from './NotAView.svelte';");
    expect(out.code).toContain("from './_lib/util.js'");
    expect(out.code).toContain("from './_lib/deep/index.js'");
    expect(out.code).toContain("import { t } from 'svelte-i18n';");
    // the proxy constants come after every import
    expect(out.code.indexOf("const B")).toBeGreaterThan(out.code.indexOf("svelte-i18n"));
    expect(out.code).toContain("<B /><Cc /><Local />");
  });

  test("no view import means no pluginView import", () => {
    const out = transformViewSource("<script>\n  let { a } = $props();\n</script>\n<p>{a}</p>\n", { sourcePath: "src/c/A.svelte", viewsBySource });
    expect(out.code).not.toContain("pluginView");
  });

  test("a view with only a view import and no other import", () => {
    const out = transformViewSource('<script>\n  import B from "./B.svelte";\n  let { a } = $props();\n</script>\n<B {a} />\n', { sourcePath: "src/c/A.svelte", viewsBySource });
    expect(out.code).toContain('import { pluginView } from "$pano/registry/view.js";');
    expect(out.code.indexOf("import { pluginView }")).toBeLessThan(out.code.indexOf("const B"));
    expect(out.code.indexOf("const B")).toBeLessThan(out.code.indexOf("let { a }"));
  });

  test("the legacy context=module attribute is handled", () => {
    const out = transformViewSource(`<script context="module">\n  export const view = { path: '/x' };\n</script>\n<p />\n`, { sourcePath: "src/c/A.svelte", viewsBySource });
    expect(out.code).not.toContain("script");
    expect(out.code.trim()).toBe("<p />");
  });
});
