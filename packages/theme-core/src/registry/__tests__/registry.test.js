import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";

mock.module("$app/environment", () => ({ dev: false, browser: false }));

const registry = await import("../index.js");
const {
  registerViews,
  registerEngineViews,
  resetPluginViews,
  resolveView,
  resolveViewModule,
  loadView,
  preloadViews,
  loadForInjection,
  getOverride,
  getDefault,
  getIssues,
  getClaims,
  getThemeProvides,
  setThemeConfig,
  setThemeMeta,
  setSlotLoader,
  describeView,
  resetRegistryForTests,
} = registry;

/** A fake default module: a component function plus the plugin's own `load`. */
const mod = (label, extra = {}) => {
  const Component = function () {};
  Component.label = label;
  return { default: Component, ...extra };
};
const thunk = (m) => async () => m;

let errorSpy;
beforeEach(() => {
  resetRegistryForTests();
  delete globalThis.__PANO_CONTROLLERS__;
  errorSpy = spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
});
afterAll(() => {
  // leave the module as other test files expect to find it (unconfigured)
  resetRegistryForTests();
});

const view = (name, over = {}) => ({
  name,
  pluginId: "pano-plugin-market",
  contract: 2,
  kind: "component",
  ...over,
});

describe("rule 1: the default", () => {
  test("an unknown name resolves to null (plugin not installed)", async () => {
    setThemeConfig({});
    expect(await resolveViewModule("market:Nope")).toBeNull();
    expect(await resolveView("market:Nope")).toBeNull();
    expect(await loadForInjection("market:Nope")).toBeNull();
    expect((await loadView({}, "market:Nope")).View).toBeNull();
  });

  test("a registered plugin view resolves to its default module", async () => {
    setThemeConfig({});
    const m = mod("D");
    registerViews([view("market:Card", { component: thunk(m) })]);
    const r = await resolveViewModule("market:Card");
    expect(r.source).toBe("default");
    expect(r.contract).toBe(2);
    expect(r.module.default).toBe(m.default);
  });

  test("an engine view from the generated table resolves without a thunk", async () => {
    setThemeConfig({});
    const m = mod("Nav");
    registerEngineViews({ Navbar: { contract: 1, component: thunk(m) } });
    expect(await resolveView("Navbar")).toBe(m.default);
  });

  test("a passed defaultThunk wins and old callers keep working", async () => {
    setThemeConfig({});
    const registered = mod("registered");
    const passed = mod("passed");
    registerEngineViews({ HomeView: { contract: 1, component: thunk(registered) } });
    expect(await resolveView("HomeView", thunk(passed))).toBe(passed.default);
    // not registered at all: the thunk alone is enough
    expect(await resolveView("Legacy", thunk(passed))).toBe(passed.default);
    // the bare-component shape (no `default` key) is passed through
    const bare = function Bare() {};
    expect(await resolveView("Bare", async () => bare)).toBe(bare);
  });
});

describe("rule 2/3: overrides, mismatch falls back to the default", () => {
  test("old thunk form is an override of contract 1", async () => {
    const ov = mod("OV");
    setThemeConfig({ views: { Navbar: thunk(ov) } });
    registerEngineViews({ Navbar: { contract: 1, component: thunk(mod("D")) } });
    const r = await resolveViewModule("Navbar");
    expect(r.source).toBe("override");
    expect(r.module.default).toBe(ov.default);
    expect(getIssues()).toEqual([]);
  });

  test("object form with a matching contract is used", async () => {
    const ov = mod("OV");
    setThemeConfig({ views: { "market:Card": { contract: 2, component: thunk(ov) } } });
    registerViews([view("market:Card", { component: thunk(mod("D")) })]);
    expect((await resolveViewModule("market:Card")).module.default).toBe(ov.default);
  });

  test("a bare module object is still accepted as an override", async () => {
    const ov = mod("OV");
    setThemeConfig({ views: { Footer: ov } });
    registerEngineViews({ Footer: { contract: 1, component: thunk(mod("D")) } });
    expect(await resolveView("Footer")).toBe(ov.default);
  });

  test("contract mismatch -> default view + CONTRACT_MISMATCH issue", async () => {
    const d = mod("D");
    setThemeConfig({ views: { "market:Card": thunk(mod("OV")) } }); // contract 1
    registerViews([view("market:Card", { component: thunk(d) })]); // contract 2
    const r = await resolveViewModule("market:Card");
    expect(r.source).toBe("default");
    expect(r.module.default).toBe(d.default);
    expect(getIssues()).toEqual([
      {
        type: "CONTRACT_MISMATCH",
        view: "market:Card",
        pluginId: "pano-plugin-market",
        themeContract: 1,
        currentContract: 2,
      },
    ]);
    expect(getOverride("market:Card")).toBeNull();
    expect(describeView("market:Card")).toEqual({
      contract: 2,
      block: false,
      overridden: true,
      overrideContract: 1,
      status: "fallback",
    });
  });

  test("an engine override of an outdated contract falls back too", async () => {
    const d = mod("D");
    setThemeConfig({ views: { Navbar: { contract: 1, component: thunk(mod("OV")) } } });
    registerEngineViews({ Navbar: { contract: 2, component: thunk(d) } });
    expect(await resolveView("Navbar")).toBe(d.default);
    expect(getIssues()[0].type).toBe("CONTRACT_MISMATCH");
  });

  test("controller pin differing from the registered version -> default + CONTROLLER_MISMATCH", async () => {
    globalThis.__PANO_CONTROLLERS__ = { list: () => [{ name: "market/cart", version: 2 }] };
    const d = mod("D");
    setThemeConfig({
      controllers: { "market/cart": 1 },
      views: { "market:Card": { contract: 2, controllers: ["market/cart"], component: thunk(mod("OV")) } },
    });
    registerViews([view("market:Card", { component: thunk(d) })]);
    const r = await resolveViewModule("market:Card");
    expect(r.source).toBe("default");
    expect(getIssues()).toEqual([
      {
        type: "CONTROLLER_MISMATCH",
        view: "market:Card",
        pluginId: "pano-plugin-market",
        controller: "market/cart",
        themeVersion: 1,
        currentVersion: 2,
      },
    ]);
  });

  test("a matching controller pin keeps the override; the registry may be a plain map", async () => {
    globalThis.__PANO_CONTROLLERS__ = { definitions: new Map([["market/cart", { version: 1 }]]) };
    const ov = mod("OV");
    setThemeConfig({
      controllers: { "market/cart": 1 },
      views: { "market:Card": { contract: 2, controllers: ["market/cart"], component: thunk(ov) } },
    });
    registerViews([view("market:Card", { component: thunk(mod("D")) })]);
    expect((await resolveViewModule("market:Card")).source).toBe("override");
    expect(getIssues()).toEqual([]);
  });

  test("no controller registry present: the pin cannot be judged, the override stays", async () => {
    const ov = mod("OV");
    setThemeConfig({
      controllers: { "market/cart": 1 },
      views: { "market:Card": { contract: 2, controllers: ["market/cart"], component: thunk(ov) } },
    });
    registerViews([view("market:Card", { component: thunk(mod("D")) })]);
    expect((await resolveViewModule("market:Card")).source).toBe("override");
  });

  test("an override that throws on import -> default + LOAD_FAILED, never a crash", async () => {
    const d = mod("D");
    setThemeConfig({
      views: {
        "market:Card": {
          contract: 2,
          component: async () => {
            throw new Error("boom");
          },
        },
      },
    });
    registerViews([view("market:Card", { component: thunk(d) })]);
    const r = await resolveViewModule("market:Card");
    expect(r.source).toBe("default");
    expect(r.module.default).toBe(d.default);
    expect(getIssues()).toMatchObject([{ type: "LOAD_FAILED", view: "market:Card", error: "boom" }]);
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("rule 4: data always comes from the default", () => {
  test("the module keeps the default's load; the override supplies markup only", async () => {
    const load = async () => ({ products: [1, 2] });
    const d = mod("D", { load, extra: "kept" });
    const ov = mod("OV", { load: async () => ({ hacked: true }) });
    setThemeConfig({ views: { "market:Card": { contract: 2, component: thunk(ov) } } });
    registerViews([view("market:Card", { component: thunk(d) })]);
    const r = await resolveViewModule("market:Card");
    expect(r.module.default).toBe(ov.default);
    expect(r.module.load).toBe(load);
    expect(r.module.extra).toBe("kept");
  });

  test("loadForInjection returns that module after preloading the closure", async () => {
    const load = async () => ({});
    const ov = mod("OV");
    setThemeConfig({ views: { "market:NavCart": { contract: 2, component: thunk(ov) } } });
    registerViews([view("market:NavCart", { component: thunk(mod("D", { load })) })]);
    const m = await loadForInjection("market:NavCart");
    expect(m.default).toBe(ov.default);
    expect(m.load).toBe(load);
    expect(getOverride("market:NavCart")).toBe(ov.default);
  });
});

describe("rule 5: caching", () => {
  test("the override and default are imported once per name", async () => {
    let imports = 0;
    setThemeConfig({});
    registerViews([
      view("market:Card", {
        component: async () => {
          imports++;
          return mod("D");
        },
      }),
    ]);
    await resolveViewModule("market:Card");
    await resolveViewModule("market:Card");
    await Promise.all([resolveView("market:Card"), resolveView("market:Card")]);
    expect(imports).toBe(1);
  });

  test("resetPluginViews forgets plugin views but keeps the engine's", async () => {
    setThemeConfig({});
    registerViews([view("market:Card", { component: thunk(mod("D")) })]);
    registerEngineViews({ Navbar: { contract: 1, component: thunk(mod("N")) } });
    await resolveView("market:Card");
    await resolveView("Navbar");
    resetPluginViews();
    expect(await resolveViewModule("market:Card")).toBeNull();
    expect(getDefault("market:Card")).toBeNull();
    expect(await resolveView("Navbar")).toBeTruthy();
  });

  test("registering a view again replaces its cached resolution", async () => {
    setThemeConfig({});
    const a = mod("A");
    const b = mod("B");
    registerViews([view("market:Card", { component: thunk(a) })]);
    expect(await resolveView("market:Card")).toBe(a.default);
    registerViews([view("market:Card", { component: thunk(b) })]);
    expect(await resolveView("market:Card")).toBe(b.default);
  });
});

describe("namespace guard and the <pluginId>:<Name> alias", () => {
  test("a def whose namespace belongs to another plugin is rejected with console.error", async () => {
    setThemeConfig({});
    const mine = mod("mine");
    registerViews([view("market:Card", { component: thunk(mine) })]);
    registerViews([
      view("market:Card", { pluginId: "market", component: thunk(mod("intruder")) }),
      view("market:Other", { pluginId: "market", component: thunk(mod("intruder")) }),
    ]);
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(String(errorSpy.mock.calls[0][0])).toContain("NAMESPACE_CLASH");
    expect(await resolveView("market:Card")).toBe(mine.default);
    expect(await resolveViewModule("market:Other")).toBeNull();
  });

  test("the same plugin may register more views in its namespace", async () => {
    setThemeConfig({});
    registerViews([view("market:A", { component: thunk(mod("A")) })]);
    registerViews([view("market:B", { component: thunk(mod("B")) })]);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(await resolveView("market:B")).toBeTruthy();
  });

  test("ids that are not <ns>:<Name> or lack a component are ignored", async () => {
    setThemeConfig({});
    registerViews([view("Bare", { component: thunk(mod("x")) }), view("market:NoComponent")]);
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(await resolveViewModule("Bare")).toBeNull();
  });

  test("<pluginId>:<Name> resolves to the same view", async () => {
    setThemeConfig({});
    const d = mod("D");
    registerViews([view("market:Card", { component: thunk(d) })]);
    expect(await resolveView("pano-plugin-market:Card")).toBe(d.default);
    expect(getDefault("pano-plugin-market:Card")).toBe(d.default);
    expect(getDefault("market:Card")).toBe(d.default);
  });

  test("a config key spelled with the plugin id is an override of the namespaced view", async () => {
    const ov = mod("OV");
    setThemeConfig({
      views: { "pano-plugin-market:Card": { contract: 2, component: thunk(ov) } },
      claims: { "pano-plugin-market:NavCart": true },
    });
    registerViews([view("market:Card", { component: thunk(mod("D")) })]);
    expect(await resolveView("market:Card")).toBe(ov.default);
    expect(getOverride("pano-plugin-market:Card")).toBe(ov.default);
    expect(getClaims().has("market:NavCart")).toBe(true);
    expect(describeView("pano-plugin-market:Card").overridden).toBe(true);
  });

  test("an alias registered after the config still maps", async () => {
    setThemeConfig({ views: { "pano-plugin-market:Card": { contract: 2, component: thunk(mod("OV")) } } });
    expect(describeView("market:Card")).toBeNull();
    registerViews([view("market:Card", { component: thunk(mod("D")) })]);
    expect(describeView("market:Card").overridden).toBe(true);
  });
});

describe("closure preload", () => {
  test("an overridden view preloads the refs of the override, a default view its uses", async () => {
    const price = mod("Price");
    const badge = mod("Badge");
    const grid = mod("Grid");
    const ovCard = mod("OvCard");
    setThemeConfig({ views: { "market:Card": { contract: 2, component: thunk(ovCard) } } });
    setThemeMeta({ refs: { "market:Card": [{ id: "market:Grid" }] }, claims: [], homePages: {} });
    registerViews([
      view("market:Card", { uses: ["market:Price", "market:Badge"], component: thunk(mod("D")) }),
      view("market:Price", { component: thunk(price) }),
      view("market:Badge", { component: thunk(badge) }),
      view("market:Grid", { component: thunk(grid) }),
    ]);
    await preloadViews(["market:Card"]);
    // the override is overridden, so its refs are walked, not the default's uses
    expect(getOverride("market:Card")).toBe(ovCard.default);
    expect(getDefault("market:Grid")).toBe(grid.default);
    expect(getDefault("market:Price")).toBeNull();
    expect(getDefault("market:Badge")).toBeNull();
  });

  test("a default view walks uses recursively and survives cycles and unknown children", async () => {
    setThemeConfig({});
    registerViews([
      view("market:A", { uses: ["market:B", "market:Missing"], component: thunk(mod("A")) }),
      view("market:B", { uses: ["market:A", "market:C"], component: thunk(mod("B")) }),
      view("market:C", { component: thunk(mod("C")) }),
    ]);
    await preloadViews(["market:A"]);
    for (const n of ["A", "B", "C"]) expect(getDefault(`market:${n}`)).toBeTruthy();
  });

  test("route: and home: meta keys expand to their refs", async () => {
    setThemeConfig({});
    setThemeMeta({ refs: { "route:/shop": [{ id: "market:Grid" }] } });
    registerViews([view("market:Grid", { component: thunk(mod("G")) })]);
    await preloadViews(["route:/shop"]);
    expect(getDefault("market:Grid")).toBeTruthy();
  });
});

describe("loadView", () => {
  test("returns View for a plain view", async () => {
    setThemeConfig({});
    const m = mod("Home");
    registerEngineViews({ HomeView: { contract: 1, component: thunk(m) } });
    expect(await loadView({}, "HomeView")).toEqual({ View: m.default });
    expect(await loadView({}, "HomeView", thunk(mod("passed")))).toBeTruthy();
  });

  test("block loads run once per distinct blockKey, keyed like PluginBlock reads them", async () => {
    const calls = [];
    const grid = mod("Grid", {
      load: async (event, props) => {
        calls.push(props);
        return { limit: props.limit };
      },
    });
    setThemeConfig({ views: { Navbar: { contract: 1, component: thunk(mod("OvNav")) } } });
    setThemeMeta({
      refs: {
        Navbar: [
          { id: "market:Grid", props: { limit: 8 } },
          { id: "market:Grid", props: { limit: 4, category: "vip" } },
          { id: "market:Grid", props: { category: "vip", limit: 4 } }, // same block, other order
          { id: "market:Plain" }, // not a block: no load
        ],
      },
    });
    registerEngineViews({ Navbar: { contract: 1, component: thunk(mod("N")) } });
    registerViews([
      view("market:Grid", { block: true, component: thunk(grid) }),
      view("market:Plain", { component: thunk(mod("Plain", { load: async () => ({ x: 1 }) })) }),
    ]);
    const out = await loadView({ url: "u" }, "Navbar");
    expect(out.View).toBeTruthy();
    expect(calls).toHaveLength(2);
    expect(out['block:market:Grid#{"limit":8}']).toEqual({ limit: 8 });
    expect(out['block:market:Grid#{"category":"vip","limit":4}']).toEqual({ limit: 4 });
    expect(Object.keys(out).filter((k) => k.startsWith("block:"))).toHaveLength(2);
  });

  test("a failing block load is skipped, the page still loads", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    setThemeConfig({ views: { Navbar: thunk(mod("OvNav")) } });
    setThemeMeta({ refs: { Navbar: [{ id: "market:Grid" }] } });
    registerEngineViews({ Navbar: { contract: 1, component: thunk(mod("N")) } });
    registerViews([
      view("market:Grid", {
        block: true,
        component: thunk(
          mod("G", {
            load: async () => {
              throw new Error("no");
            },
          }),
        ),
      }),
    ]);
    const out = await loadView({}, "Navbar");
    expect(out.View).toBeTruthy();
    expect(Object.keys(out)).toEqual(["View"]);
    warn.mockRestore();
  });

  test("slot loads run for every plugin slot over the closure, once", async () => {
    const slotCalls = [];
    setSlotLoader(async (slot, event) => {
      slotCalls.push([slot, event]);
    });
    setThemeConfig({});
    registerViews([
      view("market:Checkout", {
        uses: ["market:Summary"],
        slots: ["market:checkout:payment", "login-content"],
        component: thunk(mod("C")),
      }),
      view("market:Summary", { slots: ["market:checkout:payment", "market:checkout:shipping"], component: thunk(mod("S")) }),
    ]);
    const event = { id: "ev" };
    await loadView(event, "market:Checkout");
    expect(slotCalls.map((c) => c[0]).sort()).toEqual(["market:checkout:payment", "market:checkout:shipping"]);
    expect(slotCalls[0][1]).toBe(event);
  });

  test("the slots of an overridden host view still load (the override must keep <PluginSlot>)", async () => {
    const seen = [];
    setSlotLoader(async (slot) => seen.push(slot));
    setThemeConfig({ views: { "market:Checkout": { contract: 2, component: thunk(mod("Ov")) } } });
    registerViews([view("market:Checkout", { slots: ["market:checkout:payment"], component: thunk(mod("C")) })]);
    await loadView({}, "market:Checkout");
    expect(seen).toEqual(["market:checkout:payment"]);
  });
});

describe("claims, provides, waiting for the config", () => {
  test("claims = scanned ids plus config.claims; an explicit false wins", () => {
    setThemeConfig({ claims: { "market:CartOffcanvas": true, "market:NavCart": false } });
    setThemeMeta({ refs: {}, claims: ["market:NavCart", "market:Mini"], homePages: {} });
    const claims = getClaims();
    expect(claims.has("market:Mini")).toBe(true);
    expect(claims.has("market:CartOffcanvas")).toBe(true);
    expect(claims.has("market:NavCart")).toBe(false);
  });

  test("getThemeProvides is false only for an exact false", () => {
    setThemeConfig({});
    expect(getThemeProvides()).toEqual({ bootstrap: true, fontawesome: true });
    setThemeConfig({ provides: { bootstrap: false } });
    expect(getThemeProvides()).toEqual({ bootstrap: false, fontawesome: true });
    setThemeConfig({ provides: { bootstrap: 0, fontawesome: false } });
    expect(getThemeProvides()).toEqual({ bootstrap: true, fontawesome: false });
  });

  test("a resolve started before setThemeConfig still sees the override", async () => {
    registerEngineViews({ HomeView: { contract: 1, component: thunk(mod("D")) } });
    const ov = mod("OV");
    const pending = resolveView("HomeView");
    await new Promise((r) => setTimeout(r, 10));
    setThemeConfig({ views: { HomeView: thunk(ov) } });
    expect(await pending).toBe(ov.default);
  });
});
