import { beforeEach, describe, expect, mock, test } from "bun:test";

// FX-01: the engine wiring that nothing called before. Importing the root layout load registers the engine
// views (so a theme's override of Main, Sidebar ... resolves through loadView), and a plugin page declared
// with `controller` and no `load` gets the controller's data.

mock.module("$app/environment", () => ({ dev: false, browser: false }));
mock.module("@sveltejs/kit", () => ({
  error: (status, message) => Object.assign(new Error(`HTTP ${status} ${message ?? ""}`), { status }),
  redirect: (status, location) => Object.assign(new Error("redirect"), { status, location, redirect: true }),
}));
mock.module("$pano/lib/layouts/AppLayout.svelte", () => ({ load: async () => ({ app: 1 }) }));
mock.module("$pano/lib/layouts/MainLayout.svelte", () => ({ load: async () => ({ main: 1 }) }));

const registry = await import("../../registry/index.js");
mock.module("$pano/registry/index.js", () => registry);
const { engineViews } = await import("../views/parts/engine-views.generated.js");
mock.module("$pano/lib/views/parts/engine-views.generated.js", () => ({ engineViews }));
const controllersModule = await import("../../../../sdk/core/js/ControllerRegistry.js");
const { loadPluginPage } = await import("../../routes/plugin-ui/load.js");

const event = (extra = {}) => ({ params: {}, url: new URL("http://localhost/"), parent: async () => ({}), ...extra });

let boot = 0;
/** A fresh evaluation of the root layout load, as the first import in a process would run it. */
const importRootLayoutLoad = () => import(`../../routes/root-layout-load.js?boot${boot++}`);

beforeEach(() => {
  registry.resetRegistryForTests();
  registry.setThemeConfig({});
  controllersModule.reset();
});

describe("root layout load registers the engine views", () => {
  test("nothing is registered before the module runs, the whole table after", async () => {
    expect(registry.hasView("Main")).toBe(false);
    await importRootLayoutLoad();
    for (const name of Object.keys(engineViews)) expect(registry.hasView(name)).toBe(true);
    for (const name of ["Main", "Sidebar", "Breadcrumb", "ToastContainer", "CloseTicketConfirmModal"]) {
      expect(registry.hasView(name)).toBe(true);
    }
  });

  test("a theme override of Main resolves through loadView", async () => {
    await importRootLayoutLoad();
    registry.setThemeConfig({ views: { Main: async () => ({ default: "<ThemeMain>" }) } });

    const { View } = await registry.loadView(event(), "Main");

    expect(View).toBe("<ThemeMain>");
    expect(registry.getOverride("Main")).toBe("<ThemeMain>");
  });

  test("loadChrome preloads an override of Main and of a sidebar card, skips what the theme leaves alone", async () => {
    const { loadChrome, CHROME_VIEWS, load } = await importRootLayoutLoad();

    for (const name of ["HomeSidebar", "ProfileSidebar", "SupportSidebar", "PlayerDetailSidebar", "TicketCreateAndDetailSidebar"]) {
      expect(CHROME_VIEWS).toContain(name);
    }

    expect(await loadChrome(event())).toEqual({});
    expect(await load(event())).toEqual({ app: 1, main: 1 });

    registry.setThemeConfig({ views: { Main: async () => ({ default: "<ThemeMain>" }) } });
    expect(await loadChrome(event())).toEqual({});
    expect(registry.getOverride("Main")).toBe("<ThemeMain>");
  });

  test("a theme that overrides nothing: no override anywhere", async () => {
    await importRootLayoutLoad();
    for (const name of ["Main", "Sidebar", "Breadcrumb", "Toast"]) expect(registry.getOverride(name)).toBeNull();
  });
});

describe("plugin page data from the controller", () => {
  const PLUGIN = "pano-plugin-tst";
  const sidebarDeps = {
    hosts: {},
    PluginSidebar: {},
    executeSidebarLoad: async () => null,
    countVisible: () => 0,
  };

  function registerPage(moduleExports) {
    registry.registerViews([
      {
        name: "tst:Store",
        pluginId: PLUGIN,
        contract: 1,
        kind: "page",
        component: async () => ({ default: "<Store>", ...moduleExports }),
      },
    ]);
  }

  function registerController(load) {
    controllersModule.setHostFactory(() => ({ tag: "host" }));
    controllersModule.register(PLUGIN, "tst", [{ name: "store", version: 1, load, create: () => ({}) }]);
  }

  test("view + controller and no load: the controller's data is the page data, lifted like a load result", async () => {
    const seen = [];
    registerController(async ({ host, params }) => {
      seen.push({ host, params });
      return { products: [1, 2], pageTitle: "tst.title", breadcrumbs: [{ label: "x" }], meta: { description: "d" } };
    });
    registerPage({});

    const out = await loadPluginPage(
      event({ params: { slug: "a" } }),
      { view: "tst:Store", controller: "store", params: { id: "7" } },
      sidebarDeps,
    );

    expect(out.props.products).toEqual([1, 2]);
    expect(out.pageTitle).toBe("tst.title");
    expect(out.breadcrumbs).toEqual([{ label: "x" }]);
    expect(out.meta).toEqual({ description: "d" });
    expect(out.component.default).toBe("<Store>");
    expect(seen).toEqual([{ host: { tag: "host" }, params: { slug: "a", id: "7" } }]);
  });

  test("a module load wins over the controller", async () => {
    let controllerCalls = 0;
    registerController(async () => {
      controllerCalls += 1;
      return { from: "controller" };
    });
    registerPage({ load: async () => ({ from: "module", pageTitle: "own.title" }) });

    const out = await loadPluginPage(event(), { view: "tst:Store", controller: "store" }, sidebarDeps);

    expect(out.props).toEqual({ from: "module", pageTitle: "own.title" });
    expect(out.pageTitle).toBe("own.title");
    expect(controllerCalls).toBe(0);
  });

  test("an unknown controller or one without load gives {}", async () => {
    registerPage({});
    expect((await loadPluginPage(event(), { view: "tst:Store", controller: "nope" }, sidebarDeps)).props).toEqual({});

    registerController(undefined);
    expect((await loadPluginPage(event(), { view: "tst:Store", controller: "store" }, sidebarDeps)).props).toEqual({});
  });

  test("a page without a controller and without load has no props, as before", async () => {
    registerPage({});
    const out = await loadPluginPage(event(), { view: "tst:Store" }, sidebarDeps);
    expect(out.props).toEqual({});
  });
});
