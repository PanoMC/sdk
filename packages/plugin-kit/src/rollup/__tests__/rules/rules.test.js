import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { analyzeProject, panoRules, resolveProject } from "../../rules.js";
import { GOOD_FILES, cleanup, makePlugin, runBuildStart } from "./_fixture.js";

afterAll(cleanup);

/** @param {Record<string, string>} files */
async function analyze(files) {
  const root = makePlugin(files);
  const project = await resolveProject({ root });
  return { root, project, analysis: await analyzeProject(project) };
}

/** @param {Record<string, string>} files */
async function start(files, options = {}) {
  const root = makePlugin(files);
  return runBuildStart(panoRules({ root, ...options }));
}

describe("panoRules: a plugin that follows every rule", () => {
  test("has no violations and reports the helper closure", async () => {
    const { analysis, project } = await analyze(GOOD_FILES);

    expect(analysis.violations).toEqual([]);
    expect(analysis.views.size).toBe(2);
    expect(analysis.helpers.get("ProductCard")?.map((file) => file.replace(project.themeDir, ""))).toEqual([
      "/lib/round.js",
      "/lib/sale.js",
    ]);
    expect(analysis.helpers.get("Child")).toEqual([]);
  });

  test("buildStart passes", async () => {
    const { error, warnings } = await start(GOOD_FILES);
    expect(error).toBeNull();
    expect(warnings).toEqual([]);
  });
});

describe("V1 view imports", () => {
  test("a view importing a controller names file, line and the require() replacement", async () => {
    const { error } = await start({
      ...GOOD_FILES,
      "src/theme/controllers/pricing.js": "export default {};\n",
      "src/theme/views/ProductCard.svelte":
        '<script>\n  import { x } from "svelte";\n  import pricing from "../controllers/pricing.js";\n</script>\n<div />\n',
    });

    expect(error?.message).toBe(
      "ProductCard.svelte:3 imports ../controllers/pricing.js — controllers are compiled and closed; read it with plugin('market').require('pricing')",
    );
  });

  test("a helper importing a package says which view uses it", async () => {
    const { error } = await start({
      ...GOOD_FILES,
      "src/theme/lib/sale.js": 'import dayjs from "dayjs";\nexport const sale = () => dayjs();\n',
    });

    expect(error?.message).toBe(
      "lib/sale.js:1 (used by ProductCard.svelte) imports dayjs — view helpers ship as readable source and cannot import packages; move that code to src/theme/controllers/ (packages are bundled there)",
    );
  });

  test("a view importing a package gets the same fix", async () => {
    const { error } = await start({
      ...GOOD_FILES,
      "src/theme/views/Child.svelte": '<script>\n  import dayjs from "dayjs";\n</script>\n<p />\n',
    });

    expect(error?.message).toContain("Child.svelte:2 imports dayjs — view helpers ship as readable source and cannot import packages");
    expect(error?.message).toContain("move that code to src/theme/controllers/ (packages are bundled there)");
  });

  test("a helper that imports a controller is refused", async () => {
    const { error } = await start({
      ...GOOD_FILES,
      "src/theme/controllers/pricing.js": "export default {};\n",
      "src/theme/lib/round.js": 'import p from "../controllers/pricing.js";\nexport const round = (n) => n;\n',
    });

    expect(error?.message).toContain("lib/round.js:1 (used by ProductCard.svelte) imports ../controllers/pricing.js — controllers are compiled and closed");
  });

  test("a helper outside src/theme and a non-js import are refused", async () => {
    const { analysis } = await analyze({
      ...GOOD_FILES,
      "src/shared.js": "export const shared = 1;\n",
      "src/theme/views/Child.svelte":
        '<script>\n  import { shared } from "../../shared.js";\n  import data from "../data.json";\n</script>\n<p />\n',
      "src/theme/data.json": "{}",
    });

    const messages = analysis.violations.map((violation) => violation.message);
    expect(messages).toContain(
      "Child.svelte:2 imports ../../shared.js — view helpers must live under src/theme/ so they ship with the views",
    );
    expect(messages).toContain("Child.svelte:3 imports ../data.json — views import only .svelte files and relative .js view helpers");
  });

  test("a helper may not import svelte or the sdk (only other helpers)", async () => {
    const { analysis } = await analyze({
      ...GOOD_FILES,
      "src/theme/lib/round.js": 'import { get } from "svelte/store";\nexport const round = (n) => n;\n',
    });

    expect(analysis.violations.map((violation) => violation.message)).toEqual([
      expect.stringContaining("lib/round.js:1 (used by ProductCard.svelte) imports svelte/store"),
    ]);
  });
});

describe("V2 controller purity", () => {
  const files = {
    ...GOOD_FILES,
    "src/theme/controllers/cart.js": 'import { session } from "../stores/session.js";\nexport default {};\n',
    "src/theme/stores/session.js": 'import { writable } from "svelte/store";\nexport const session = writable(null);\n',
  };

  test("the error shows the import chain", async () => {
    const { error } = await start(files);

    expect(error?.message).toBe(
      "controllers/cart.js -> stores/session.js:1 imports svelte/store — controllers are framework-free; use host.session().",
    );
  });

  test("the sdk, $app and a .svelte file are refused too; packages and helpers are fine", async () => {
    const { analysis } = await analyze({
      ...GOOD_FILES,
      "src/theme/controllers/a.js": 'import x from "@panomc/sdk/controllers";\nimport y from "$app/navigation";\nimport V from "../views/Child.svelte";\nimport dayjs from "dayjs";\nimport { sale } from "../lib/sale.js";\nexport default {};\n',
    });

    expect(analysis.violations.map((violation) => violation.rule)).toEqual(["V2", "V2", "V2"]);
    expect(analysis.violations.map((violation) => violation.message)).toEqual([
      expect.stringContaining("controllers/a.js:1 imports @panomc/sdk/controllers"),
      expect.stringContaining("controllers/a.js:2 imports $app/navigation"),
      expect.stringContaining("controllers/a.js:3 imports ../views/Child.svelte"),
    ]);
  });

  test("V2 stays an error in migration mode", async () => {
    const { error } = await start(files, { viewImports: "warn" });
    expect(error?.message).toContain("controllers/cart.js -> stores/session.js:1 imports svelte/store");
  });
});

describe("V3 sample purity", () => {
  test("a samples file importing a package fails", async () => {
    const { error } = await start({
      ...GOOD_FILES,
      "src/theme/views/ProductCard.samples.js": 'import dayjs from "dayjs";\nexport const filled = {};\n',
    });

    expect(error?.message).toBe(
      "views/ProductCard.samples.js:1 imports dayjs — sample files are pure data: import only view helpers and other relative .js fixtures (no packages, no Svelte, no @panomc/sdk)",
    );
  });

  test("the chain through a fixture file is shown; relative .js fixtures pass", async () => {
    const { analysis } = await analyze({
      ...GOOD_FILES,
      "src/theme/views/ProductCard.samples.js": 'import { product } from "../fixtures/product.js";\nimport { sale } from "../lib/sale.js";\nexport const filled = { product };\n',
      "src/theme/fixtures/product.js": 'import { get } from "svelte/store";\nexport const product = {};\n',
    });

    expect(analysis.violations.map((violation) => violation.message)).toEqual([
      "views/ProductCard.samples.js -> fixtures/product.js:1 imports svelte/store — sample files are pure data: import only view helpers and other relative .js fixtures (no packages, no Svelte, no @panomc/sdk)",
    ]);
  });
});

describe("V5 no context between views", () => {
  const files = {
    ...GOOD_FILES,
    "src/theme/views/Child.svelte":
      '<script>\n  import { getContext } from "svelte";\n\n  const session = getContext("session");\n</script>\n<p />\n',
  };

  test("getContext in a view names file, line and the replacement", async () => {
    const { error } = await start(files);

    expect(error?.message).toBe(
      'Child.svelte:4 getContext("session"): views run in two Svelte copies on the server; take it as a prop or read host data through @panomc/sdk',
    );
  });

  test("setContext, hasContext, aliases and a namespace import are found", async () => {
    const { analysis } = await analyze({
      ...GOOD_FILES,
      "src/theme/views/Child.svelte":
        '<script>\n  import { setContext as put, hasContext } from "svelte";\n  import * as S from "svelte";\n  put("a", 1);\n  const h = hasContext("b");\n  S.getContext("c");\n</script>\n<p />\n',
    });

    expect(analysis.violations.map((violation) => violation.message)).toEqual([
      expect.stringContaining('Child.svelte:4 setContext("a")'),
      expect.stringContaining('Child.svelte:5 hasContext("b")'),
      expect.stringContaining('Child.svelte:6 getContext("c")'),
    ]);
  });

  test("a module-script call is found as well, and the same name from elsewhere is not", async () => {
    const { analysis } = await analyze({
      ...GOOD_FILES,
      "src/theme/views/Child.svelte":
        '<script module>\n  import { getContext } from "svelte";\n  export const view = {};\n</script>\n<script>\n  const getContext2 = () => 1;\n  const x = getContext("k");\n</script>\n<p />\n',
      "src/theme/views/Other.svelte": '<script>\n  const getContext = () => 1;\n  getContext("k");\n</script>\n<p />\n',
    });

    expect(analysis.violations.map((violation) => violation.message)).toEqual([
      expect.stringContaining('Child.svelte:7 getContext("k")'),
    ]);
  });
});

describe("PANO_VIEW_IMPORTS=warn (migration mode)", () => {
  const files = {
    ...GOOD_FILES,
    "src/theme/controllers/pricing.js": "export default {};\n",
    "src/theme/views/ProductCard.svelte":
      '<script>\n  import pricing from "../controllers/pricing.js";\n  import { getContext } from "svelte";\n  getContext("x");\n</script>\n<div />\n',
  };

  afterEach(() => {
    delete process.env.PANO_VIEW_IMPORTS;
  });

  test("turns V1 and V5 into warnings and sets the manifest flag", async () => {
    process.env.PANO_VIEW_IMPORTS = "warn";

    const root = makePlugin(files);
    const plugin = panoRules({ root });
    const { error, warnings } = await runBuildStart(plugin);

    expect(error).toBeNull();
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("ProductCard.svelte:2 imports ../controllers/pricing.js");
    expect(warnings[1]).toContain('ProductCard.svelte:4 getContext("x")');
    expect(plugin.api.viewImports).toBe("warn");
    expect(plugin.api.manifestFlags()).toEqual({ viewImports: "warn" });
  });

  test("without the variable the same plugin fails and sets no flag", async () => {
    const root = makePlugin(files);
    const plugin = panoRules({ root });
    const { error } = await runBuildStart(plugin);

    expect(error?.message).toContain("2 build rule violations");
    expect(plugin.api.viewImports).toBe("error");
    expect(plugin.api.manifestFlags()).toEqual({});
  });

  test("the shared context gets the mode", async () => {
    const context = /** @type {Record<string, any>} */ ({});
    await runBuildStart(panoRules({ root: makePlugin(files), viewImports: "warn", context }));
    expect(context.viewImports).toBe("warn");
    expect(context.violations).toHaveLength(2);
  });
});
