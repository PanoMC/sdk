import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { writable } from "svelte/store";
import { get } from "svelte/store";

// The SvelteKit aliases are not installed in this repo: stub what PluginAPI.js and its imports use.
class Redirect {
  constructor(status, location) {
    this.status = status;
    this.location = location;
  }
}
const navigations = [];
// bun mocks are process-wide and a module that is already linked cannot gain exports: every stub below is a
// superset of what the other suites mock for the same specifier.
mock.module("@sveltejs/kit", () => ({
  redirect: (status, location) => {
    throw new Redirect(status, location);
  },
  error: (status) => Object.assign(new Error(`HTTP ${status}`), { status }),
}));
mock.module("$app/paths", () => ({ base: "" }));
mock.module("$app/environment", () => ({ browser: false, dev: false }));
mock.module("$app/navigation", () => ({
  goto: async (url, options) => {
    navigations.push({ url, options });
  },
  invalidate: async () => {},
  invalidateAll: async () => {},
}));
// Store.js (a relative import of PluginAPI.js) still reaches for the alias
const returnToUtil = await import("../returnTo.util.js");
mock.module("$pano/lib/returnTo.util.js", () => returnToUtil);
mock.module("$pano/lib/services/auth.js", () => ({ sendLogout: async () => {} }));
mock.module("$pano/lib/components/ToastContainer.svelte", () => ({
  show: async () => {},
  showSuccess: async () => {},
  showError: async () => {},
  limitTitle: (text) => text,
}));
// bun mocks are process-wide: a superset of what the other suites stub for the same file.
const pluginManagerStub = () => ({
  plugins: writable({}),
  registeredPages: {},
  findMatch: () => null,
});
mock.module("@panomc/sdk/core/js/PluginManager.js", pluginManagerStub);
mock.module(new URL("../../../../sdk/core/js/PluginManager.js", import.meta.url).pathname, pluginManagerStub);
// (factories return resolved namespaces: a factory that returns a promise can deadlock against the other
// suites that mock the same specifier)
const sdkPluginApi = await import("../../../../sdk/core/js/PluginAPI.js");
mock.module("@panomc/sdk/core/js/PluginAPI", () => sdkPluginApi);
// PluginAPI imports the engine, the registry and returnTo.util relatively, so this suite runs the REAL ones
// whatever the other suites mock for the `$pano/...` spelling.
const registry = await import("../../registry/index.js");
const { setRouteConfig } = await import("../../registry/routes.js");
const controllersModule = await import("../../../../sdk/core/js/ControllerRegistry.js");
// a query makes this instance independent of other suites that import PluginAPI with their own mocks
const api = await import("../PluginAPI.js?pluginApiViews");
const { panoApi, init, executeViewLoad, executeHookLoad, THEME_FEATURE_IDS } = api;

const pluginManager = await import("@panomc/sdk/core/js/PluginManager.js");

const MARKET = "pano-plugin-market";
const Page = function Page() {};
const Card = function Card() {};
const load = async () => ({ products: [1, 2] });

const def = (name, over = {}) => ({
  name,
  pluginId: MARKET,
  contract: 1,
  kind: "component",
  component: async () => ({ default: Card, load }),
  ...over,
});

let errorSpy;
let warnSpy;
// bun mocks are process-wide and later-loaded suites replace them: install the two that record behaviour per test
function installSpies() {
  mock.module("@sveltejs/kit", () => ({
    redirect: (status, location) => {
      throw new Redirect(status, location);
    },
    error: (status) => Object.assign(new Error(`HTTP ${status}`), { status }),
  }));
  mock.module("$app/navigation", () => ({
    goto: async (url, options) => {
      navigations.push({ url, options });
    },
    invalidate: async () => {},
    invalidateAll: async () => {},
  }));
}

beforeEach(async () => {
  installSpies();
  registry.resetRegistryForTests();
  await init();
  navigations.length = 0;
  errorSpy = spyOn(console, "error").mockImplementation(() => {});
  warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  registry.setThemeConfig({});
});
afterEach(async () => {
  setRouteConfig();
  errorSpy.mockRestore();
  warnSpy.mockRestore();
  await init();
  registry.resetRegistryForTests();
});

const warnings = () => warnSpy.mock.calls.map((call) => String(call[0]));
const errors = () => errorSpy.mock.calls.map((call) => String(call[0]));

describe("pano.views", () => {
  test("add registers the defaults; has and describe answer for them", () => {
    expect(panoApi.views.has("market:ProductCard")).toBe(false);
    expect(panoApi.views.describe("market:ProductCard")).toBeNull();

    panoApi.views.add([def("market:ProductCard", { contract: 2 })]);

    expect(panoApi.views.has("market:ProductCard")).toBe(true);
    // the pluginId spelling is accepted as an alias
    expect(panoApi.views.has(`${MARKET}:ProductCard`)).toBe(true);
    expect(panoApi.views.describe("market:ProductCard")).toEqual({
      contract: 2,
      block: false,
      overridden: false,
      overrideContract: null,
      status: "default",
    });
  });

  test("a def whose namespace belongs to another plugin is rejected, and so are its pages and injections", () => {
    panoApi.views.add([def("market:ProductCard")]);
    panoApi.views.add([
      def("market:Intruder", {
        pluginId: "pano-plugin-evil",
        page: { path: "/intruder" },
        inject: [{ slot: "profile-content", id: "intruder" }],
      }),
    ]);

    expect(panoApi.views.has("market:Intruder")).toBe(false);
    expect(panoApi.ui.page.isPluginPage("/intruder")).toBe(false);
    expect(get(panoApi.ui.view.get("profile-content"))).toEqual([]);
    expect(errors().join("\n")).toContain("NAMESPACE_CLASH");
  });

  test("add applies a page: it is registered with the view and a component thunk that keeps the plugin's load", async () => {
    panoApi.views.add([
      def("market:StorePage", {
        kind: "page",
        page: { path: "/store", loginRequired: true },
        home: { label: "Store" },
        component: async () => ({ default: Page, load }),
      }),
    ]);

    expect(panoApi.ui.page.isPluginPage("/store")).toBe(true);

    const registered = Object.values(pluginManager.registeredPages).find((page) => page.path === "/store");
    expect(registered).toMatchObject({
      path: "/store",
      view: "market:StorePage",
      loginRequired: true,
      home: { label: "Store" },
      pluginId: MARKET,
    });

    const module = await registered.component();
    expect(module.default).toBe(Page);
    expect(module.load).toBe(load);
    expect(warnings()).toEqual([]);
  });

  test("add applies slot, sidebar and hook injections", async () => {
    panoApi.views.add([
      def("market:NavCart", {
        inject: [
          { slot: "navbar-right", id: "market-cart", priority: 40 },
          { sidebar: "home", priority: 5 },
          { hook: "theme:top", skipLoad: true },
        ],
      }),
    ]);

    const [slotItem] = get(panoApi.ui.view.get("navbar-right"));
    expect(slotItem).toMatchObject({ id: "market-cart", priority: 40, view: "market:NavCart" });

    const [sidebarItem] = get(panoApi.ui.sidebar.get("home"));
    // no explicit id: the view id; a sidebar item gets the prop sidebarId
    expect(sidebarItem).toMatchObject({ id: "market:NavCart", priority: 5, props: { sidebarId: "home" } });

    const [hookEntry] = get(panoApi.ui.hook.get("theme:top"));
    expect(hookEntry).toMatchObject({ view: "market:NavCart", skipLoad: true, name: "theme:top" });

    // all three resolve to the default module
    expect((await slotItem.component()).default).toBe(Card);
    expect((await hookEntry.component()).default).toBe(Card);
  });

  test("an array of slots injects into each", () => {
    panoApi.views.add([def("market:Badge", { inject: [{ slot: ["profile-content", "settings-content"] }] })]);

    expect(get(panoApi.ui.view.get("profile-content")).length).toBe(1);
    expect(get(panoApi.ui.view.get("settings-content")).length).toBe(1);
  });
});

describe("normalizeItem", () => {
  test("a `view` item resolves through the registry and survives a later edit", async () => {
    panoApi.views.add([def("market:ProductCard")]);

    panoApi.ui.profile.content.edit((items) => {
      items.push({ id: "card", priority: 5, view: "market:ProductCard" });
    });

    const resolved = await executeViewLoad("profile-content", {});
    expect(resolved).toHaveLength(1);
    // the module is stored on the item, with the plugin's load result as props.data
    expect(typeof resolved[0].component).toBe("object");
    expect(resolved[0].component.default).toBe(Card);
    expect(resolved[0].props.data).toEqual({ products: [1, 2] });

    // a later edit must not blank the loaded module back into a thunk
    panoApi.ui.profile.content.edit((items) => {
      items.push({ id: "other", priority: 1, component: "local:other" });
    });

    const [card] = get(panoApi.ui.profile.content.get()).filter((item) => item.id === "card");
    expect(typeof card.component).toBe("object");
    expect(card.component.default).toBe(Card);
  });

  test("an item whose view changed gets a new component thunk", async () => {
    const Other = function Other() {};
    panoApi.views.add([def("market:A"), def("market:B", { component: async () => ({ default: Other }) })]);

    const item = { id: "x", view: "market:A" };
    panoApi.ui.profile.content.edit((items) => items.push(item));
    expect((await item.component()).default).toBe(Card);

    panoApi.ui.profile.content.edit((items) => {
      items[0].view = "market:B";
    });
    expect((await item.component()).default).toBe(Other);
  });

  test("a theme override supplies the markup, the default supplies the load", async () => {
    const Override = function Override() {};
    registry.setThemeConfig({
      views: { "market:ProductCard": { contract: 1, component: async () => ({ default: Override, load: () => ({ no: 1 }) }) } },
    });
    panoApi.views.add([def("market:ProductCard")]);

    panoApi.ui.profile.content.edit((items) => items.push({ id: "card", view: "market:ProductCard" }));

    const [resolved] = await executeViewLoad("profile-content", {});
    expect(resolved.component.default).toBe(Override);
    expect(resolved.props.data).toEqual({ products: [1, 2] });
  });

  test("an unknown view id drops the item and names the closest registered view", () => {
    panoApi.views.add([def("market:ProductCard"), def("market:Cart")]);

    panoApi.ui.profile.content.edit((items) => {
      items.push({ id: "typo", view: "market:ProductCrad", pluginId: MARKET });
    });

    expect(get(panoApi.ui.profile.content.get())).toEqual([]);
    const message = errors().join("\n");
    expect(message).toContain("market:ProductCrad");
    expect(message).toContain("closest registered view: 'market:ProductCard'");
    expect(message).toContain(MARKET);
  });

  test("an unknown view id with nothing registered still drops the item", () => {
    panoApi.ui.view.register({ viewId: "navbar-right", id: "x", view: "market:Nope" });

    expect(get(panoApi.ui.view.get("navbar-right"))).toEqual([]);
    expect(errors().join("\n")).toContain("market:Nope");
  });

  test("the `component` form without a view is dropped with an error naming the replacement", async () => {
    const component = async () => ({ default: Card, load });

    for (const id of ["one", "two"]) {
      panoApi.ui.view.register({ viewId: "navbar-right", id, component, pluginId: MARKET });
    }
    panoApi.ui.profile.content.edit((items) => items.push({ id: "three", component, pluginId: MARKET }));

    expect(await executeViewLoad("navbar-right", {})).toEqual([]);
    expect(await executeViewLoad("profile-content", {})).toEqual([]);

    const dropped = errors().filter((text) => text.includes("registered with 'component'"));
    expect(dropped).toHaveLength(3);
    expect(dropped[0]).toContain(MARKET);
    expect(dropped[0]).toContain("export const view = { hook: '...' }");
  });

  test("an item with a view and a stray component loads without the component", async () => {
    panoApi.views.add([def("market:A")]);
    panoApi.ui.view.register({
      viewId: "navbar-right",
      id: "both",
      view: "market:A",
      component: async () => ({ default: function Stray() {} }),
      pluginId: MARKET,
    });

    const [resolved] = await executeViewLoad("navbar-right", {});
    expect(resolved.component.default).toBe(Card);
    expect(warnings().filter((text) => text.includes("registered with 'component'"))).toEqual([]);
  });

  test("engine items with a string component are not warned about", () => {
    panoApi.ui.profile.nav.edit((items) => items.push({ id: "profile-nav", component: "local:profile-nav" }));

    expect(warnings()).toEqual([]);
  });

  test("page.register takes `view`, and drops an unknown view and a bare component", async () => {
    panoApi.views.add([def("market:CartPage")]);

    panoApi.ui.page.register({ path: "/cart", view: "market:CartPage" });
    panoApi.ui.page.register({ path: "/ghost", view: "market:Ghost" });
    panoApi.ui.page.register({ path: "/old", component: async () => ({ default: Page }) });

    expect(panoApi.ui.page.isPluginPage("/cart")).toBe(true);
    expect(panoApi.ui.page.isPluginPage("/ghost")).toBe(false);
    expect(panoApi.ui.page.isPluginPage("/old")).toBe(false);

    const cart = Object.values(pluginManager.registeredPages).find((page) => page.path === "/cart");
    expect((await cart.component()).default).toBe(Card);
  });

  test("the plugin's page object is not mutated", () => {
    panoApi.views.add([def("market:CartPage")]);
    const page = { path: "/cart2", view: "market:CartPage" };
    panoApi.ui.page.register(page);

    expect(page.component).toBeUndefined();
  });
});

describe("claims: the theme places the view itself", () => {
  async function registerThree() {
    panoApi.views.add([
      def("market:A", { component: async () => ({ default: Card, load: async () => ({ id: "A" }) }) }),
      def("market:NavCart", { component: async () => ({ default: Card, load: async () => ({ id: "NavCart" }) }) }),
      def("market:C", { component: async () => ({ default: Card, load: async () => ({ id: "C" }) }) }),
    ]);

    for (const name of ["A", "NavCart", "C"]) {
      panoApi.ui.hook.register({ name: "theme:top", view: `market:${name}` });
    }
  }

  test("hook positions stay aligned and the claimed view's load never runs", async () => {
    registry.setThemeMeta({ claims: ["market:NavCart"] });
    await registerThree();

    const list = get(panoApi.ui.hook.get("theme:top"));
    const props = await executeHookLoad("theme:top", {});

    expect(list.map((entry) => entry.view)).toEqual(["market:A", "market:C"]);
    expect(props.map((p) => p.id)).toEqual(["A", "C"]);
  });

  test("`claims: { id: false }` keeps the automatic copy", async () => {
    registry.setThemeMeta({ claims: ["market:NavCart"] });
    registry.setThemeConfig({ claims: { "market:NavCart": false } });
    await registerThree();

    expect(get(panoApi.ui.hook.get("theme:top")).map((entry) => entry.view)).toEqual([
      "market:A",
      "market:NavCart",
      "market:C",
    ]);
  });

  test("a claim made with the plugin-id spelling suppresses the item", async () => {
    registry.setThemeMeta({ claims: [`${MARKET}:NavCart`] });
    await registerThree();

    expect(get(panoApi.ui.hook.get("theme:top")).map((entry) => entry.view)).not.toContain("market:NavCart");
  });

  test("a slot item is left out of the read and of the load", async () => {
    registry.setThemeMeta({ claims: ["market:NavCart"] });
    panoApi.views.add([
      def("market:NavCart", {
        inject: [{ slot: "navbar-right", id: "market-cart" }],
        component: async () => ({
          default: Card,
          load: async () => {
            throw new Error("must not load");
          },
        }),
      }),
      def("market:Other", { inject: [{ slot: "navbar-right", id: "other" }] }),
    ]);

    expect(get(panoApi.ui.nav.rightComponents.get()).map((item) => item.id)).toEqual(["other"]);
    expect((await executeViewLoad("navbar-right", {})).map((item) => item.id)).toEqual(["other"]);
    expect(warnings().join("\n")).not.toContain("Load failed");
  });
});

describe("init()", () => {
  test("forgets plugin views, controllers, hooks, slots and nav links", async () => {
    panoApi.views.add([def("market:A", { inject: [{ slot: "navbar-right" }] })]);
    panoApi.controllers.register(MARKET, "market", {
      cart: { name: "cart", version: 1, create: () => ({ get: () => ({}), subscribe() {}, actions: {}, destroy() {} }) },
    });
    panoApi.ui.nav.site.editNavLinks((links) => [...links, { id: "l", href: "/store", text: "Store" }]);

    expect(panoApi.views.has("market:A")).toBe(true);
    expect(panoApi.controllers.has("market/cart")).toBe(true);

    await init();

    expect(panoApi.views.has("market:A")).toBe(false);
    expect(panoApi.controllers.has("market/cart")).toBe(false);
    expect(get(panoApi.ui.view.get("navbar-right"))).toEqual([]);
    expect(get(panoApi.ui.nav.site.getNavLinks())).toEqual([]);
    // the same registry the SDK exposes
    expect(panoApi.controllers).toBe(controllersModule.controllers);
  });

  test("a namespace freed by init() can be taken by another plugin", async () => {
    panoApi.views.add([def("market:A")]);
    await init();
    panoApi.views.add([def("market:A", { pluginId: "pano-plugin-other" })]);

    expect(panoApi.views.has("market:A")).toBe(true);
    expect(errors().join("\n")).not.toContain("NAMESPACE_CLASH");
  });
});

describe("feature ids", () => {
  test("the new ids are announced", () => {
    for (const id of ["named-views", "plugin-slots", "blocks", "route-map"]) {
      expect(THEME_FEATURE_IDS).toContain(id);
      expect(panoApi.features.has(id)).toBe(true);
    }
    expect(new Set(THEME_FEATURE_IDS).size).toBe(THEME_FEATURE_IDS.length);
  });
});

describe("routes: what plugins are handed goes through route()", () => {
  const rename = { "/store": "/shop", "/store/[slug]": "/shop/[slug]", "/login": "/signin" };

  test("pano.routes.resolve is route()", () => {
    expect(panoApi.routes.resolve("/store")).toBe("/store");

    setRouteConfig({ routes: { rename } });

    expect(panoApi.routes.resolve("/store")).toBe("/shop");
    expect(panoApi.routes.resolve("/store/vip?x=1")).toBe("/shop/vip?x=1");
    expect(panoApi.routes.resolve("/profile")).toBe("/profile");
    expect(panoApi.routes.resolve("https://example.com/store")).toBe("https://example.com/store");
  });

  test("site nav links are published under the theme's path, once, even when read late", () => {
    panoApi.ui.nav.site.editNavLinks((links) => [...links, { id: "store", href: "/store", text: "Store", priority: 1 }]);

    expect(get(panoApi.ui.nav.site.getNavLinks())[0].href).toBe("/store");

    setRouteConfig({ routes: { rename } });

    const links = get(panoApi.ui.nav.site.getNavLinks());
    expect(links[0].href).toBe("/shop");
    // the stored link is untouched: an edit that runs again cannot map it twice
    panoApi.ui.nav.site.editNavLinks((current) => current);
    expect(get(panoApi.ui.nav.site.getNavLinks())[0].href).toBe("/shop");
  });

  test("auth.loginUrl and requireLogin follow a renamed login route", async () => {
    expect(panoApi.auth.loginUrl("/store/checkout")).toBe("/login?redirect=%2Fstore%2Fcheckout");

    setRouteConfig({ routes: { rename } });

    expect(panoApi.auth.loginUrl("/store/checkout")).toBe("/signin?redirect=%2Fstore%2Fcheckout");
    expect(panoApi.auth.loginUrl()).toBe("/signin");

    const event = {
      parent: async () => ({ session: { user: null } }),
      url: new URL("https://site.test/cart?x=1"),
    };

    let thrown;
    try {
      await panoApi.auth.requireLogin(event);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Redirect);
    expect(thrown.status).toBe(302);
    expect(thrown.location).toBe("/signin?redirect=%2Fcart%3Fx%3D1");

    // a logged-in user passes
    await panoApi.auth.requireLogin({ ...event, parent: async () => ({ session: { user: { id: 1 } } }) });
  });

  test("routedGoto and routedRedirect map site paths only", async () => {
    setRouteConfig({ routes: { rename } });

    await api.routedGoto("/store", { replaceState: true });
    await api.routedGoto("https://elsewhere.test/store");
    await api.routedGoto("//elsewhere.test/store");

    expect(navigations).toEqual([
      { url: "/shop", options: { replaceState: true } },
      { url: "https://elsewhere.test/store", options: undefined },
      { url: "//elsewhere.test/store", options: undefined },
    ]);

    expect(() => api.routedRedirect(303, "/store/vip")).toThrow();
    try {
      api.routedRedirect(303, "/store/vip");
    } catch (e) {
      expect(e.location).toBe("/shop/vip");
      expect(e.status).toBe(303);
    }
  });
});
