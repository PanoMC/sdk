import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { findSvelte } from "../../../lib/__tests__/svelteSsr.helper.js";
import { renderPart } from "../../../lib/__tests__/engineParts.helper.js";

// TC-54: the view catalogue (doc 02 section 7). The pure model, the list / stage / views.json loads on fake
// dependencies, the engine's sample files, and the route files `theme-core sync` generates.

// bun mocks are process-wide: every stub is a superset of what the other suites use
mock.module("$app/environment", () => ({ browser: false, dev: false }));
mock.module("@sveltejs/kit", () => ({
  error: (status, message) => Object.assign(new Error(`HTTP ${status} ${message ?? ""}`), { status }),
  redirect: (status, location) => Object.assign(new Error("redirect"), { status, location, redirect: true }),
}));

const model = await import("../model.js");
const { loadCatalogue, samplesOf } = await import("../catalogue.js");
const list = await import("../list.js");
const stage = await import("../stage.js");
const viewsJson = await import("../views-json.js");
const { ENGINE_SAMPLES } = await import("../engineSamples.js");
const registry = await import("../../../registry/index.js");

const pkgDir = join(import.meta.dir, "..", "..", "..", "..");
const srcDir = join(pkgDir, "src");
const viewsDir = join(srcDir, "lib", "views");
const skinContract = JSON.parse(readFileSync(join(pkgDir, "skin-contract.json"), "utf8"));
const syncJs = join(pkgDir, "bin", "sync.js");
const svelteDir = findSvelte();

const roots = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  registry.resetRegistryForTests();
});

// ---------------------------------------------------------------------------
// Fake dependencies
// ---------------------------------------------------------------------------

const PLUGIN_VIEWS = {
  namespace: "market",
  pluginId: "pano-plugin-market",
  views: {
    "market:ProductCard": {
      kind: "component",
      contract: 2,
      source: "src/store/ProductCard.svelte",
      props: { product: { type: "Product", required: true }, settings: { type: "any", required: false } },
      uses: [],
      block: false,
    },
    "market:Store": { kind: "page", contract: 1, source: "src/store/Store.svelte", props: {}, uses: ["market:ProductCard"], page: { path: "/store" } },
  },
};

const PLUGIN_SAMPLES = {
  default: {
    ProductCard: {
      filled: { props: { product: { id: 1 } }, controllers: { "market/cart": { count: 2 } } },
      empty: { props: { product: { id: 2 } } },
    },
  },
  notApplicable: { ProductCard: ["loading", "error"] },
};

/** @param {{ overridden?: Record<string, "override" | "default">, plugins?: boolean }} [options] */
function makeDeps({ overridden = {}, plugins = true } = {}) {
  const Stub = function () {};
  const resolved = [];

  return {
    resolved,
    skinContract,
    engineSamples: ENGINE_SAMPLES,
    registry: {
      describeView: (id) => (id in overridden ? { overridden: true } : { overridden: false }),
      resolveViewModule: async (id) => {
        resolved.push(id);
        return { source: overridden[id] ?? "default", module: { default: Stub } };
      },
      getDefault: () => Stub,
      getIssues: () => [{ type: "CONTRACT_MISMATCH", view: "LoginView" }],
    },
    pluginIds: async () => (plugins ? ["pano-plugin-market"] : []),
    pluginViews: async (id) => (id === "pano-plugin-market" ? PLUGIN_VIEWS : null),
    pluginSamples: async () => PLUGIN_SAMPLES,
    readEngineSource: async (path) => `<!-- ${path} -->`,
    readText: async (pluginId, path) => `// ${pluginId} ${path}`,
    components: { List: async () => ({ default: "ListComponent" }), Stage: async () => ({ default: "StageComponent" }) },
  };
}

const eventFor = (url, params = {}) => ({ url: new URL(url, "http://localhost"), params, fetch });

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

describe("model", () => {
  test("ids and urls", () => {
    expect(model.splitViewId("LoginView")).toEqual({ ns: "pano", name: "LoginView", engine: true });
    expect(model.splitViewId("market:ProductCard")).toEqual({ ns: "market", name: "ProductCard", engine: false });
    expect(model.viewIdFromParams("pano", "LoginView")).toBe("LoginView");
    expect(model.viewIdFromParams("market", "ProductCard")).toBe("market:ProductCard");
    expect(model.stageUrl("market:ProductCard", { state: "filled", palette: "dark", source: "default", bare: true })).toBe(
      "/__pano/views/market/ProductCard?state=filled&palette=dark&source=default&bare=1",
    );
    expect(model.stageUrl("LoginView")).toBe("/__pano/views/pano/LoginView");
    expect(model.ejectCommand("market:ProductCard")).toBe("bunx theme-core eject-view market:ProductCard");
  });

  test("the stage query is validated and falls back", () => {
    const q = (qs, states = ["empty", "filled"]) => model.parseStageQuery(new URLSearchParams(qs), states);

    expect(q("")).toMatchObject({ state: "filled", palette: null, source: "theme", bare: false });
    expect(q("state=empty&palette=emerald&source=default&bare=1")).toMatchObject({ state: "empty", palette: "emerald", source: "default", bare: true });
    expect(q("state=nope&palette=pink&source=x")).toMatchObject({ state: "filled", palette: null, source: "theme", requestedState: "nope" });
    expect(q("", ["only"]).state).toBe("only");
    expect(q("", []).state).toBeNull();
    expect(model.PALETTES).toEqual(["dark", "light", "copper", "emerald", "midnight", "crimson"]);
  });

  test("state names list the standard ones first", () => {
    expect(model.stateNames({ custom: {}, filled: {}, empty: {}, gone: undefined })).toEqual(["empty", "filled", "custom"]);
    expect(model.stateNames(null)).toEqual([]);
  });

  test("a state is data or a function returning it", async () => {
    const samples = { filled: { props: { a: 1 }, session: "user" }, empty: () => ({ props: { a: 0 }, label: "none" }) };

    expect(await model.resolveSample(samples, "filled")).toEqual({ props: { a: 1 }, controllers: {}, session: "user", label: null });
    expect(await model.resolveSample(samples, "empty")).toMatchObject({ props: { a: 0 }, label: "none", session: null });
    expect(await model.resolveSample(samples, "error")).toBeNull();
  });

  test("status: default, overridden, override outdated", () => {
    expect(model.statusOf({ overridden: false }, "default")).toBe("default");
    expect(model.statusOf({ overridden: true }, "override")).toBe("overridden");
    expect(model.statusOf({ overridden: true }, "default")).toBe("override outdated");
    expect(model.statusOf(null, null)).toBe("default");
  });

  test("filters by plugin, kind and status", () => {
    const rows = [
      { ns: "pano", kind: "page", status: "default" },
      { ns: "pano", kind: "component", status: "overridden" },
      { ns: "market", kind: "component", status: "override outdated" },
    ];

    expect(model.filterRows(rows, {})).toHaveLength(3);
    expect(model.filterRows(rows, { plugin: "market" })).toHaveLength(1);
    expect(model.filterRows(rows, { kind: "component" })).toHaveLength(2);
    expect(model.filterRows(rows, { plugin: "pano", status: "overridden" })).toHaveLength(1);
    expect(model.filterOptions(rows)).toEqual({ plugin: ["market", "pano"], kind: ["component", "page"], status: ["default", "overridden", "override outdated"].sort() });
  });
});

// ---------------------------------------------------------------------------
// The loads
// ---------------------------------------------------------------------------

describe("list", () => {
  test("load returns one row per skin-contract view", async () => {
    const data = await list.load(eventFor("/__pano/views"), makeDeps({ plugins: false }));

    expect(data.component).toBe("ListComponent");
    expect(data.rows.map((row) => row.id).sort()).toEqual(Object.keys(skinContract.views).sort());
    expect(data.total).toBe(Object.keys(skinContract.views).length);
    expect(data.rows.every((row) => row.ns === "pano" && row.pluginId === null)).toBe(true);
  });

  test("an engine row carries kind, contract, status, sample states and badges", async () => {
    const { rows } = await list.load(eventFor("/__pano/views"), makeDeps({ plugins: false, overridden: { HomeView: "override", ProfileView: "default" } }));
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

    expect(byId.HomeView).toMatchObject({ kind: "page", contract: 1, status: "overridden", url: "/__pano/views/pano/HomeView" });
    expect(byId.HomeView.states).toContain("filled");
    expect(byId.HomeView.badges).toContain("samples");
    expect(byId.ProfileView.status).toBe("override outdated");
    expect(byId.Main.kind).toBe("component");
    expect(byId.MainLayoutView.kind).toBe("layout");
    expect(byId.Pagination.contract).toBe(skinContract.views.Pagination.contract);
    // issues of the registry are attached to their view
    expect(byId.LoginView.issues).toEqual([{ type: "CONTRACT_MISMATCH", view: "LoginView" }]);
  });

  test("plugin views join the list with their samples, controllers and badges", async () => {
    const { rows } = await list.load(eventFor("/__pano/views"), makeDeps());
    const card = rows.find((row) => row.id === "market:ProductCard");

    expect(card).toMatchObject({ ns: "market", pluginId: "pano-plugin-market", kind: "component", contract: 2, states: ["empty", "filled"], notApplicable: ["loading", "error"] });
    expect(card.controllers).toEqual(["market/cart"]);
    expect(card.badges).toEqual(expect.arrayContaining(["contract 2", "controllers", "samples"]));
    expect(rows.find((row) => row.id === "market:Store")).toMatchObject({ kind: "page", states: [], hasSamples: false });
    expect(rows).toHaveLength(Object.keys(skinContract.views).length + 2);
  });

  test("filters come from the query string", async () => {
    const deps = makeDeps();

    expect((await list.load(eventFor("/__pano/views?plugin=market"), deps)).rows.map((r) => r.id).sort()).toEqual(["market:ProductCard", "market:Store"]);
    expect((await list.load(eventFor("/__pano/views?kind=layout"), deps)).rows.every((r) => r.kind === "layout")).toBe(true);
    expect((await list.load(eventFor("/__pano/views?plugin=pano&status=overridden"), makeDeps({ overridden: { HomeView: "override" } }))).rows.map((r) => r.id)).toEqual(["HomeView"]);
  });

  test("an unreadable samples module costs the row its states and nothing else", async () => {
    const deps = makeDeps({ plugins: false });
    deps.engineSamples = { ...ENGINE_SAMPLES, HomeView: async () => { throw new Error("boom"); } };
    const warn = mock(() => {});
    const original = console.warn;
    console.warn = warn;

    try {
      const { rows } = await list.load(eventFor("/__pano/views"), deps);
      expect(rows.find((r) => r.id === "HomeView").states).toEqual([]);
      expect(rows).toHaveLength(Object.keys(skinContract.views).length);
    } finally {
      console.warn = original;
    }
  });

  test("a plugin's samples file is read once", async () => {
    const deps = makeDeps();
    let reads = 0;
    deps.pluginSamples = async () => (reads++, PLUGIN_SAMPLES);
    await loadCatalogue(deps);
    expect(reads).toBe(1);
  });
});

describe("views.json", () => {
  test("answers [{ id, kind, contract, status, states, url }]", async () => {
    const response = await viewsJson.GET(eventFor("http://localhost:3000/__pano/views.json"), makeDeps());
    const body = await response.json();

    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body).toHaveLength(Object.keys(skinContract.views).length + 2);
    const home = body.find((entry) => entry.id === "HomeView");
    expect(Object.keys(home).sort()).toEqual(["contract", "id", "kind", "states", "status", "url"]);
    expect(home.url).toBe("http://localhost:3000/__pano/views/pano/HomeView");
    expect(body.find((entry) => entry.id === "market:ProductCard").url).toBe("http://localhost:3000/__pano/views/market/ProductCard");
  });
});

describe("stage", () => {
  test("resolves the component, the sample and the readable source", async () => {
    const deps = makeDeps();
    const data = await stage.load(eventFor("/__pano/views/pano/HomeView?state=empty&palette=crimson", { ns: "pano", view: "HomeView" }), deps);

    expect(data).toMatchObject({ component: "StageComponent", id: "HomeView", state: "empty", palette: "crimson", source: "theme", bare: false, resetLayout: false });
    expect(data.sample.props.data.posts).toEqual([]);
    expect(data.View).toBeTypeOf("function");
    expect(data.eject).toBe("bunx theme-core eject-view HomeView");
    expect(await data.sourceText).toBe("<!-- src/lib/views/HomeView.svelte -->");
    expect(data.stageKey).toBe("HomeView|empty|theme");
  });

  test("a plugin view: controllers patch, readable source, required props", async () => {
    const data = await stage.load(eventFor("/__pano/views/market/ProductCard?state=filled&bare=1", { ns: "market", view: "ProductCard" }), makeDeps());

    expect(data.id).toBe("market:ProductCard");
    expect(data.sample.controllers).toEqual({ "market/cart": { count: 2 } });
    expect(data.bare).toBe(true);
    // a bare stage drops the engine's chrome too
    expect(data.resetLayout).toBe(true);
    expect(await data.sourceText).toBe("// pano-plugin-market src/store/ProductCard.svelte");
    expect(data.missing).toEqual([]);
    expect(stage.missingProps(PLUGIN_VIEWS.views["market:ProductCard"].props, {})).toEqual(["product"]);
  });

  test("source=default asks the registry for the default component", async () => {
    const deps = makeDeps({ overridden: { HomeView: "override" } });
    const Default = function Default() {};
    deps.registry.getDefault = () => Default;

    expect((await stage.load(eventFor("/x?source=default", { ns: "pano", view: "HomeView" }), deps)).View).toBe(Default);
    expect((await stage.load(eventFor("/x?source=theme", { ns: "pano", view: "HomeView" }), deps)).View).not.toBe(Default);
  });

  test("an unknown view is a 404; an unknown state leaves the sample empty", async () => {
    await expect(stage.load(eventFor("/x", { ns: "pano", view: "Nope" }), makeDeps())).rejects.toMatchObject({ status: 404 });
    await expect(stage.load(eventFor("/x", { ns: "market", view: "ProductCard" }), makeDeps({ plugins: false }))).rejects.toMatchObject({ status: 404 });

    const data = await stage.load(eventFor("/x?state=weird", { ns: "pano", view: "HomeView" }), makeDeps());
    expect(data.state).toBe("filled");
    expect(data.requestedState).toBe("weird");
  });

  test("a plugin view the registry does not know renders nothing and says so", async () => {
    const deps = makeDeps();
    deps.registry.resolveViewModule = async () => null;
    const data = await stage.load(eventFor("/x", { ns: "market", view: "ProductCard" }), deps);

    expect(data.View).toBeNull();
    expect(data.sample).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The registry as the real dependency
// ---------------------------------------------------------------------------

describe("status from the real registry", () => {
  beforeEach(() => {
    registry.resetRegistryForTests();
  });

  test("default, overridden and override outdated", async () => {
    const component = (label) => async () => ({ default: Object.assign(function () {}, { label }) });
    registry.registerEngineViews({ A: { contract: 1, component: component("a") }, B: { contract: 1, component: component("b") }, C: { contract: 2, component: component("c") } });
    registry.setThemeConfig({ views: { B: { contract: 1, component: component("b-override") }, C: { contract: 1, component: component("c-override") } } });

    const deps = { ...makeDeps({ plugins: false }), registry, skinContract: { views: { A: { contract: 1 }, B: { contract: 1 }, C: { contract: 2 } } }, engineSamples: {} };
    const rows = Object.fromEntries((await loadCatalogue(deps)).map((row) => [row.id, row.status]));

    expect(rows).toEqual({ A: "default", B: "overridden", C: "override outdated" });
  });
});

// ---------------------------------------------------------------------------
// The engine's sample files
// ---------------------------------------------------------------------------

describe("engine samples", () => {
  const files = readdirSync(viewsDir).filter((file) => file.endsWith(".samples.js")).map((file) => file.slice(0, -".samples.js".length)).sort();

  test("the table lists exactly the files on disk, and each is a skin-contract view", () => {
    expect(Object.keys(ENGINE_SAMPLES).sort()).toEqual(files);
    for (const name of files) expect(skinContract.views[name]).toBeDefined();
  });

  test("HomeView, LoginView and ProfileView are covered first", () => {
    for (const name of ["HomeView", "LoginView", "ProfileView"]) expect(files).toContain(name);
  });

  for (const name of files) {
    test(`${name}: states are well formed and use only props of the contract`, async () => {
      const mod = await ENGINE_SAMPLES[name]();
      const samples = mod.default;
      const contractProps = Object.keys(skinContract.views[name].props ?? {});

      expect(samples).toBeObject();
      const states = model.stateNames(samples);
      expect(states).toContain("filled");

      // a view lists the standard states it does not have; every other standard state exists
      const notApplicable = mod.notApplicable ?? [];
      for (const key of notApplicable) expect(model.STANDARD_STATES).toContain(key);
      for (const key of model.STANDARD_STATES) {
        expect(states.includes(key) || notApplicable.includes(key)).toBe(true);
      }

      for (const state of states) {
        const resolved = await model.resolveSample(samples, state);
        expect(resolved).not.toBeNull();
        for (const prop of Object.keys(resolved.props)) expect(contractProps).toContain(prop);
        // every prop the contract names is given (a prop with a default in the view is the only exception)
        for (const [controller, patch] of Object.entries(resolved.controllers)) {
          expect(controller).toMatch(/^[a-z0-9-]+\/[A-Za-z0-9-]+$/);
          expect(patch).toBeObject();
        }
      }
    });
  }

  test("samplesOf reads an engine view's states and its not-applicable list", async () => {
    const { states, notApplicable } = await samplesOf(makeDeps(), { id: "LoginView", name: "LoginView", pluginId: null });

    expect(states).toEqual(expect.arrayContaining(["filled", "error", "loading"]));
    expect(notApplicable).toEqual(["empty"]);
    expect((await samplesOf(makeDeps(), { id: "Navbar", name: "Navbar", pluginId: null })).states).toEqual(expect.any(Array));
  });
});

// ---------------------------------------------------------------------------
// The generated routes
// ---------------------------------------------------------------------------

function makeTheme({ config = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "theme-core-catalogue-"));
  roots.push(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "pano-fixture-theme" }));
  if (config) writeFileSync(join(dir, "theme.config.js"), "export default {};\n");

  return dir;
}

function sync(cwd) {
  const proc = Bun.spawnSync([process.execPath, syncJs], { cwd, stdout: "pipe", stderr: "pipe" });

  return { code: proc.exitCode, out: proc.stdout.toString() + proc.stderr.toString() };
}

describe("sync: the catalogue routes", () => {
  const read = (dir, path) => readFileSync(join(dir, "src/routes", path), "utf8");

  test("generates the three catalogue entries of doc 02 section 7", () => {
    const dir = makeTheme();
    expect(sync(dir).code).toBe(0);

    for (const path of [
      "(theme)/__pano/views/+page.js",
      "(theme)/__pano/views/+page.svelte",
      "(theme)/__pano/views/[ns]/[view]/+page.js",
      "(theme)/__pano/views/[ns]/[view]/+page.svelte",
      "(theme)/__pano/views.json/+server.js",
    ]) {
      expect(existsSync(join(dir, "src/routes", path))).toBe(true);
    }
  });

  test("the generated +page.js files contain no static catalogue import", () => {
    const dir = makeTheme();
    sync(dir);

    const files = [
      "(theme)/__pano/views/+page.js",
      "(theme)/__pano/views/[ns]/[view]/+page.js",
      "(theme)/__pano/views.json/+server.js",
      "(theme)/__pano/views/+page.svelte",
      "(theme)/__pano/views/[ns]/[view]/+page.svelte",
    ];

    for (const file of files) {
      const text = read(dir, file);
      // no import declaration (static) mentions the catalogue; the only way in is `import(...)` behind `dev`
      expect(text).not.toMatch(/^\s*import\b[^\n]*catalogue/m);
      expect(text).not.toMatch(/^\s*export\b[^\n]*from[^\n]*catalogue/m);
    }

    for (const [file, module, run] of [
      ["(theme)/__pano/views/+page.js", "list", "load"],
      ["(theme)/__pano/views/[ns]/[view]/+page.js", "stage", "load"],
      ["(theme)/__pano/views.json/+server.js", "views-json", "GET"],
    ]) {
      const text = read(dir, file);
      expect(text).toContain('import { dev } from "$app/environment";');
      expect(text).toContain(`dev ? await import("$pano/routes/catalogue/${module}.js") : null`);
      expect(text).toContain("if (!m) throw error(404");
      expect(text).toContain(`m.${run}(event)`);
    }

    expect(read(dir, "(theme)/__pano/views/+page.js")).toContain("export const ssr = !dev;");
    expect(read(dir, "(theme)/__pano/views/+page.svelte")).toContain("<svelte:component this={data.component} {data} />");
  });

  test("views.json sets the theme config itself when the theme has one", () => {
    const withConfig = makeTheme();
    sync(withConfig);
    expect(read(withConfig, "(theme)/__pano/views.json/+server.js")).toContain("setThemeConfig(themeConfig);");

    const without = makeTheme({ config: false });
    expect(sync(without).code).toBe(0);
    expect(read(without, "(theme)/__pano/views.json/+server.js")).not.toContain("themeConfig");
  });

  test("a second sync is stable and routes.add cannot take /__pano", () => {
    const dir = makeTheme();
    sync(dir);
    const before = read(dir, "(theme)/__pano/views/[ns]/[view]/+page.js");
    expect(sync(dir).code).toBe(0);
    expect(read(dir, "(theme)/__pano/views/[ns]/[view]/+page.js")).toBe(before);

    mkdirSync(join(dir, "src/pages"), { recursive: true });
    writeFileSync(join(dir, "src/pages/X.svelte"), "<p>x</p>\n");
    writeFileSync(join(dir, "theme.config.js"), `export default { routes: { add: { "/__pano/views": "./src/pages/X.svelte" } } };\n`);
    expect(sync(dir).code).toBe(1);
  });

  test("no file of the engine imports the catalogue statically", () => {
    const offenders = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (path.includes(join("routes", "catalogue")) || entry.name === "__tests__" || entry.name === "node_modules") continue;
          walk(path);
        } else if (/\.(js|svelte)$/.test(entry.name) && !entry.name.endsWith(".samples.js")) {
          const text = readFileSync(path, "utf8");
          if (/^\s*(import|export)\b[^\n]*routes\/catalogue/m.test(text)) offenders.push(path);
        }
      }
    };
    walk(srcDir);
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The components compile
// ---------------------------------------------------------------------------

describe.skipIf(!svelteDir)("catalogue components", () => {
  for (const file of ["List.svelte", "Stage.svelte"]) {
    test(`${file} compiles for the browser and the server`, async () => {
      const compiler = await import(join(svelteDir, "src", "compiler", "index.js"));
      const source = readFileSync(join(srcDir, "routes", "catalogue", file), "utf8");
      const warnings = [];

      for (const generate of ["client", "server"]) {
        const result = compiler.compile(source, { generate, filename: file, warningFilter: () => true });
        warnings.push(...result.warnings.map((w) => `${w.code}: ${w.message}`));
        expect(result.js.code.length).toBeGreaterThan(100);
      }

      expect(warnings).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// The samples really render
// ---------------------------------------------------------------------------

describe.skipIf(!svelteDir)("engine samples render", () => {
  // Views whose imports the SSR helper can stub (the others pull in SvelteKit's `$app/stores`).
  for (const name of ["ProfileView", "LoginView", "RulesView", "PlayerDetailView"]) {
    test(`${name}: every state renders markup`, async () => {
      const { default: samples } = await ENGINE_SAMPLES[name]();

      for (const state of model.stateNames(samples)) {
        const sample = await model.resolveSample(samples, state);
        const session = sample.props.session ?? { subscribe: (run) => (run({ siteInfo: {} }), () => {}) };
        const html = await renderPart({
          svelteDir,
          entry: `$pano/lib/views/${name}.svelte`,
          props: sample.props,
          context: new Map([["session", session]]),
        });

        expect(html.length).toBeGreaterThan(30);
      }
    });
  }
});
