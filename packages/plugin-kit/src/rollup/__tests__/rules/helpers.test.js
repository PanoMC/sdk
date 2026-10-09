import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { rollup } from "rollup";
import svelte from "rollup-plugin-svelte";
import { panoHelpers, writeViewHelpers } from "../../helpers.js";
import { analyzeProject, panoRules, resolveProject } from "../../rules.js";
import { panoStamp } from "../../stamp.js";
import { cleanup, makePlugin } from "./_fixture.js";

afterAll(cleanup);

const CART = `import { defineController } from "@panomc/plugin-kit/controller";
export default defineController({ name: "cart", version: 1, state: () => ({}), actions: () => ({}) });
`;

const PRODUCT_CARD = `<script>
  import { plugin } from "@panomc/sdk/controllers";
  import { sale } from "../../lib/sale.js";
  import Badge from "./Badge.svelte";

  const cart = plugin("market").require("cart");
</script>
<div>{sale(2)}<Badge /></div>
`;

const FILES = {
  "src/theme/components/store/ProductCard.svelte": PRODUCT_CARD,
  "src/theme/components/store/Badge.svelte": "<b>badge</b>\n",
  "src/theme/lib/sale.js": 'import { round } from "./util/round.js";\nexport const sale = (n) => round(n);\n',
  "src/theme/lib/util/round.js": "export const round = (n) => Math.round(n);\n",
  "src/theme/lib/unused.js": "export const unused = 1;\n",
  "src/theme/controllers/cart.js": CART,
};

/**
 * Stand-in for panoViews' readable copy: writes every view source to `contract/src/<path under its view folder>`.
 *
 * @param {string} root
 * @param {string} outDir
 */
function copyViews(root, outDir) {
  return {
    name: "test-views-copy",
    writeBundle() {
      const base = path.join(root, "src/theme/components");

      for (const relative of ["store/ProductCard.svelte", "store/Badge.svelte"]) {
        const target = path.join(outDir, "contract/src", relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(base, relative), target);
      }
    },
  };
}

describe("view helpers and the full rule set in one build", () => {
  test("copies the helper closure readable, rewrites the readable view copy, stamps only the compiled output", async () => {
    const root = makePlugin(FILES);
    const outDir = path.join(root, "out");
    const options = { root, viewDirs: ["src/theme/components"], outDir };
    const helpers = panoHelpers(options);
    const stamp = panoStamp(options);

    const bundle = await rollup({
      input: "\0entry",
      external: [/^@panomc\//, /^svelte/],
      plugins: [
        {
          name: "test-entry",
          resolveId: (id) => (id === "\0entry" ? id : null),
          load: (id) =>
            id === "\0entry"
              ? `export { default as ProductCard } from ${JSON.stringify(path.join(root, "src/theme/components/store/ProductCard.svelte"))};`
              : null,
        },
        svelte({ emitCss: false }),
        panoRules(options),
        helpers,
        stamp,
        copyViews(root, outDir),
      ],
    });
    await bundle.write({ dir: path.join(outDir, "client"), format: "es" });
    await bundle.close();

    const compiled = fs
      .readdirSync(path.join(outDir, "client"))
      .map((name) => fs.readFileSync(path.join(outDir, "client", name), "utf8"))
      .join("\n");

    // compiled output: stamped
    expect(compiled).toContain('.require("cart", { version: 1 })');

    // readable helpers: only the closure, path as under src/theme, unchanged
    const lib = path.join(outDir, "contract/src/_lib");
    expect(fs.readFileSync(path.join(lib, "lib/sale.js"), "utf8")).toBe(FILES["src/theme/lib/sale.js"]);
    expect(fs.readFileSync(path.join(lib, "lib/util/round.js"), "utf8")).toBe(FILES["src/theme/lib/util/round.js"]);
    expect(fs.existsSync(path.join(lib, "lib/unused.js"))).toBe(false);

    // readable view copy: helper specifier rewritten, controller call unstamped, view import untouched
    const copy = fs.readFileSync(path.join(outDir, "contract/src/store/ProductCard.svelte"), "utf8");
    expect(copy).toContain('import { sale } from "../_lib/lib/sale.js";');
    expect(copy).toContain('import Badge from "./Badge.svelte";');
    expect(copy).toContain('plugin("market").require("cart");');
    expect(copy).not.toContain("version");

    // what pano-plugin.json needs
    expect(helpers.api.helpers.get("ProductCard")).toEqual(["lib/sale.js", "lib/util/round.js"]);
    expect(helpers.api.helpers.get("Badge")).toEqual([]);
    expect(helpers.api.allHelpers).toEqual(["lib/sale.js", "lib/util/round.js"]);
    expect(stamp.api.usage.get("ProductCard")).toEqual({ "market/cart": 1 });

    // the rewritten copy resolves: the helper sits where the specifier says
    expect(fs.existsSync(path.resolve(path.join(outDir, "contract/src/store"), "../_lib/lib/sale.js"))).toBe(true);
  });

  test("writing twice changes nothing (no reload loop in watch mode)", async () => {
    const root = makePlugin(FILES);
    const outDir = path.join(root, "out");
    const project = await resolveProject({ root, viewDirs: ["src/theme/components"] });
    const analysis = await analyzeProject(project);

    copyViews(root, outDir).writeBundle();
    const first = await writeViewHelpers(project, analysis, outDir);
    const copy = path.join(outDir, "contract/src/store/ProductCard.svelte");
    const after = fs.readFileSync(copy, "utf8");
    const mtime = fs.statSync(path.join(outDir, "contract/src/_lib/lib/sale.js")).mtimeMs;

    const second = await writeViewHelpers(project, analysis, outDir);

    expect(first.rewritten).toEqual(["store/ProductCard.svelte"]);
    expect(second.rewritten).toEqual([]);
    expect(fs.readFileSync(copy, "utf8")).toBe(after);
    expect(fs.statSync(path.join(outDir, "contract/src/_lib/lib/sale.js")).mtimeMs).toBe(mtime);
  });

  test("a plugin without helpers writes no _lib folder", async () => {
    const root = makePlugin({ "src/theme/views/A.svelte": "<p />\n" });
    const outDir = path.join(root, "out");
    const project = await resolveProject({ root });

    const result = await writeViewHelpers(project, await analyzeProject(project), outDir);

    expect(result.copied).toEqual([]);
    expect(fs.existsSync(path.join(outDir, "contract/src/_lib"))).toBe(false);
  });
});
