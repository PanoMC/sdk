import { afterAll, describe, expect, test } from "bun:test";
import { panoStamp, readControllerVersions } from "../../stamp.js";
import { resolveProject } from "../../rules.js";
import { buildViews } from "./_build.js";
import { cleanup, makePlugin } from "./_fixture.js";

afterAll(cleanup);

const CART = `import { defineController } from "@panomc/plugin-kit/controller";
export default defineController({ name: "cart", version: 3, state: () => ({}), actions: () => ({}) });
`;
const FORMAT = `import { defineController } from "@panomc/plugin-kit/controller";
export default defineController({ name: "format", version: 2, state: () => ({}), actions: () => ({}) });
`;

/** @param {string} body */
const view = (body) => `<script>\n  import { plugin } from "@panomc/sdk/controllers";\n${body}\n</script>\n<p />\n`;

describe("stamping", () => {
  test("reads the versions from defineController calls", async () => {
    const root = makePlugin({ "src/theme/controllers/cart.js": CART, "src/theme/controllers/format.js": FORMAT, "src/theme/controllers/_private.js": "export const x = 1;\n" });
    expect(await readControllerVersions(await resolveProject({ root }))).toEqual({ cart: 3, format: 2 });
  });

  test("require / use / load get { version }, readable copy stays as written", async () => {
    const source = view(`  const market = plugin("market");
  const cart = market.require("cart");
  const fmt = plugin("market").use("format");
  const later = market.load("cart", { params: { a: 1 } });
  const kept = market.use("cart", { version: 9 });`);
    const root = makePlugin({
      "src/theme/controllers/cart.js": CART,
      "src/theme/controllers/format.js": FORMAT,
      "src/theme/views/A.svelte": source,
    });
    const stamp = panoStamp({ root });
    const { code } = await buildViews(root, ["src/theme/views/A.svelte"], [stamp]);

    expect(code).toContain('market.require("cart", { version: 3 })');
    expect(code).toContain('plugin("market").use("format", { version: 2 })');
    expect(code).toMatch(/market\.load\("cart", \{ params: \{ a: 1 \}, version: 3 \}\)/);
    expect(code).toContain('market.use("cart", { version: 9 })');
    expect(stamp.api.usage.get("A")).toEqual({ "market/cart": 3, "market/format": 2 });

    // the readable copy is the author's source: the plugin never writes to it
    const { default: fs } = await import("node:fs");
    expect(fs.readFileSync(`${root}/src/theme/views/A.svelte`, "utf8")).toBe(source);
    expect(source).not.toContain("version: 3");
  });

  test("destructured methods, a variable options object and useController", async () => {
    const root = makePlugin({
      "src/theme/controllers/cart.js": CART,
      "src/theme/views/A.svelte": `<script>
  import { plugin, useController as uc } from "@panomc/sdk/controllers";
  const { require: need } = plugin("market");
  const a = need("cart");
  const opts = { params: {} };
  const b = plugin("market").use("cart", opts);
  const c = uc("market/cart");
  const d = uc("other/cart");
  const e = plugin("other").require("cart");
</script>
<p />
`,
    });
    const { code } = await buildViews(root, ["src/theme/views/A.svelte"], [panoStamp({ root })]);

    expect(code).toContain('need("cart", { version: 3 })');
    expect(code).toContain('.use("cart", { ...(opts), version: 3 })');
    expect(code).toContain('useController("market/cart", { version: 3 })');
    expect(code).toContain('useController("other/cart")');
    expect(code).toContain('plugin("other").require("cart")');
  });

  test("a non-literal controller name is a build error with the author's line", async () => {
    const root = makePlugin({
      "src/theme/controllers/cart.js": CART,
      "src/theme/views/A.svelte": view(`  const name = "cart";\n\n  const cart = plugin("market").require(name);`),
    });

    await expect(buildViews(root, ["src/theme/views/A.svelte"], [panoStamp({ root })])).rejects.toThrow(
      "A.svelte:5 require(name) — controller names must be string literals so the build can stamp their version",
    );
  });

  test("an unknown controller name warns and is left alone", async () => {
    const root = makePlugin({
      "src/theme/controllers/cart.js": CART,
      "src/theme/views/A.svelte": view(`  const x = plugin("market").require("missing");`),
    });
    const warnings = /** @type {string[]} */ ([]);
    const { code } = await buildViews(root, ["src/theme/views/A.svelte"], [panoStamp({ root })], {
      onwarn: (message) => warnings.push(message),
    });

    expect(code).toContain('require("missing")');
    expect(warnings.join("\n")).toContain("A.svelte:3 require('missing') — no controller named missing");
  });

  test("an explicit controllers option replaces reading the files", async () => {
    const root = makePlugin({ "src/theme/views/A.svelte": view(`  const x = plugin("market").require("cart");`) });
    const { code } = await buildViews(root, ["src/theme/views/A.svelte"], [panoStamp({ root, controllers: { "market/cart": 7 } })]);
    expect(code).toContain('require("cart", { version: 7 })');
  });

  test("a view without controller calls is left untouched", async () => {
    const root = makePlugin({ "src/theme/views/A.svelte": "<p>hi</p>\n" });
    const stamp = panoStamp({ root });
    await buildViews(root, ["src/theme/views/A.svelte"], [stamp]);
    expect(stamp.api.usage.get("A")).toEqual({});
  });
});
