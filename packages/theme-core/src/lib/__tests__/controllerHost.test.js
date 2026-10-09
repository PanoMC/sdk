import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { get, writable } from "svelte/store";
import { addMessages, init as initI18n, locale } from "svelte-i18n";

// ---- stubs for what the host imports --------------------------------------------------------------------------
const calls = { api: [], toasts: [], gotos: [] };
let apiResult = { result: "ok" };
let apiFails = false;

const ApiUtil = {
  async customRequest(options) {
    calls.api.push(options);
    // let other requests run: this is what makes SSR requests interleave
    await Promise.resolve();
    if (apiFails) throw new Error("boom");
    return typeof apiResult === "function" ? apiResult(options) : apiResult;
  },
};

const panoApiStub = {
  features: { has: (name) => name === "named-views" },
  auth: { loginUrl: (returnTo) => `/login?redirect=${returnTo ?? ""}` },
};

const setEnvironment = (browser) => mock.module("$app/environment", () => ({ browser, dev: false }));

// bun mocks are process-wide, a module that is already linked cannot gain exports, and suites loaded later
// replace what this one installed: every stub is a superset of the others', and all of them are installed
// again before each test. (Factories return plain objects: a factory that returns a promise can deadlock
// against the suites that mock the same specifier.)
function installMocks() {
  setEnvironment(false);
  mock.module("$app/navigation", () => ({ goto: async () => {}, invalidate: async () => {}, invalidateAll: async () => {} }));
  mock.module("$pano/lib/api.util.js", () => ({ default: ApiUtil }));
  mock.module("$pano/lib/PluginAPI.js", () => ({
    panoApi: panoApiStub,
    routedGoto: (url, options) => calls.gotos.push({ url, options }),
  }));
}

installMocks();

const { setRouteConfig } = await import("../../registry/routes.js");
const host = await import("../controllerHost.js?controllerHost");
const { createThemeHost, themeHostFactory, bindControllerSession, resetControllerSessionForTests, setToastForTests } = host;
setToastForTests((...args) => calls.toasts.push(args));

addMessages("en", { "plugins.pano-plugin-market.hello": "Hello {name}", plain: "Plain" });
await initI18n({ fallbackLocale: "en", initialLocale: "en" });

const eventFor = (user, csrfToken, extra = {}) => ({
  locals: { user, csrfToken },
  url: new URL("https://site.test/store"),
  ...extra,
});

beforeEach(() => {
  installMocks();
  calls.api.length = 0;
  calls.toasts.length = 0;
  calls.gotos.length = 0;
  apiResult = { result: "ok" };
  apiFails = false;
  resetControllerSessionForTests();
  setEnvironment(false);
});
afterEach(() => {
  resetControllerSessionForTests();
  setRouteConfig();
  setEnvironment(false);
});

describe("server host: nothing request-bound is stored", () => {
  test("the host reads the session of the event it was created for", () => {
    const ada = createThemeHost({ event: eventFor({ id: 1, username: "ada" }, "csrf-ada") });

    expect(ada.session()).toEqual({ user: { id: 1, username: "ada" }, csrfToken: "csrf-ada" });
    expect(ada.browser).toBe(false);
    expect(ada.baseUrl).toBe("https://site.test");
  });

  test("two interleaved SSR requests never see each other's session", async () => {
    apiResult = (options) => ({ items: [], seenToken: options.csrfToken });

    const ada = createThemeHost({ event: eventFor({ id: 1 }, "csrf-ada") });
    const bob = createThemeHost({ event: eventFor({ id: 2 }, "csrf-bob") });
    const guest = createThemeHost({ event: eventFor(null, null) });

    const order = [];
    const run = async (name, h, expectedUser, expectedToken) => {
      order.push(`${name}:before`);
      expect(h.session().user?.id ?? null).toBe(expectedUser);
      const result = await h.request({ path: "/cart" });
      order.push(`${name}:after`);
      // after the await another request has run: the session is still this request's own
      expect(h.session().user?.id ?? null).toBe(expectedUser);
      expect(h.session().csrfToken).toBe(expectedToken);
      expect(result.seenToken ?? null).toBe(expectedToken);
    };

    await Promise.all([run("ada", ada, 1, "csrf-ada"), run("bob", bob, 2, "csrf-bob"), run("guest", guest, null, null)]);

    // really interleaved: everybody started before anybody finished
    expect(order.indexOf("bob:before")).toBeLessThan(order.indexOf("ada:after"));
    expect(order.indexOf("guest:before")).toBeLessThan(order.indexOf("ada:after"));

    // the request event travelled with each call
    expect(calls.api.map((call) => call.request.locals.csrfToken).sort()).toEqual(
      [null, "csrf-ada", "csrf-bob"].sort(),
    );
  });

  test("bindControllerSession binds nothing on the server", () => {
    const store = writable({ user: { id: 7 }, csrfToken: "leak" });
    const unbind = bindControllerSession(store);

    expect(typeof unbind).toBe("function");
    // not even subscribed
    expect(createThemeHost({ event: eventFor(null, null) }).session()).toEqual({ user: null, csrfToken: null });
    expect(createThemeHost().session()).toEqual({ user: null, csrfToken: null });
    const seen = [];
    createThemeHost().onSession((s) => seen.push(s));
    store.set({ user: { id: 8 }, csrfToken: "x" });
    expect(seen).toEqual([]);
  });

  test("without an event the server host is a guest and cannot request", async () => {
    const h = createThemeHost();

    expect(h.session()).toEqual({ user: null, csrfToken: null });
    expect(await h.request({ path: "/x" })).toEqual({ error: { code: "NO_REQUEST_EVENT" } });
    expect(calls.api).toEqual([]);
    expect(h.storage("local")).toBeNull();
    h.toast("plain");
    h.navigate("/x");
    expect(calls.toasts).toEqual([]);
    expect(calls.gotos).toEqual([]);
    expect(h.onSession(() => {})()).toBeUndefined();
  });
});

describe("themeHostFactory (what controllers.setHostFactory gets)", () => {
  test("the registry hands the factory the bare SvelteKit event; the host is bound to it", async () => {
    const event = eventFor({ id: 7, username: "gus" }, "csrf-gus");
    const made = themeHostFactory(event);

    expect(made.session()).toEqual({ user: { id: 7, username: "gus" }, csrfToken: "csrf-gus" });
    expect(made.baseUrl).toBe("https://site.test");

    const answer = await made.request({ path: "/plugins/pano-plugin-market/store" });

    expect(answer).not.toEqual({ error: { code: "NO_REQUEST_EVENT" } });
    expect(calls.api[0].request).toBe(event);
  });

  test("a guest server call (controllers.load with an event, no user) still reaches ApiUtil", async () => {
    const made = themeHostFactory(eventFor(null, null));

    await made.request({ path: "/plugins/pano-plugin-market/store/products", query: { page: 2 } });

    expect(calls.api[0].path).toBe("/plugins/pano-plugin-market/store/products?page=2");
  });

  test("without an event (browser) the factory still builds a host", () => {
    expect(themeHostFactory().browser).toBe(false);
  });
});

describe("request", () => {
  test("passes method, path with query, body, headers and the event through ApiUtil", async () => {
    const event = eventFor({ id: 1 }, "tok");
    const h = createThemeHost({ event });
    apiResult = { items: [{ id: 1 }], page: {} };

    const result = await h.request({
      method: "post",
      path: "/cart/items",
      query: { a: 1, b: ["x", "y z"], skip: undefined, none: null, zero: 0 },
      body: { sku: "A" },
      headers: { "X-Test": "1" },
    });

    expect(result).toEqual({ items: [{ id: 1 }], page: {} });
    expect(calls.api).toHaveLength(1);
    expect(calls.api[0]).toMatchObject({
      path: "/cart/items?a=1&b=x&b=y%20z&zero=0",
      data: { method: "POST", body: { sku: "A" }, headers: { "X-Test": "1" } },
      request: event,
      csrfToken: "tok",
    });
  });

  test("a GET carries no body", async () => {
    const h = createThemeHost({ event: eventFor(null, null) });
    await h.request({ path: "/posts", body: { ignored: true } });

    expect(calls.api[0].data).toEqual({ method: "GET" });
    expect(calls.api[0].csrfToken).toBeUndefined();
  });

  test("a failed network call resolves NETWORK_ERROR and never rejects", async () => {
    const h = createThemeHost({ event: eventFor(null, null) });

    apiResult = undefined;
    expect(await h.request({ path: "/x" })).toEqual({ error: { code: "NETWORK_ERROR" } });

    apiFails = true;
    expect(await h.request({ path: "/x" })).toEqual({ error: { code: "NETWORK_ERROR" } });
  });

  test("a legacy string error becomes { error: { code } } and keeps the other keys", async () => {
    const h = createThemeHost({ event: eventFor(null, null) });

    apiResult = { result: "error", error: "CART_EMPTY" };
    expect(await h.request({ path: "/x" })).toEqual({ result: "error", error: { code: "CART_EMPTY" } });

    apiResult = { error: { code: "FORBIDDEN", details: { a: 1 } } };
    expect(await h.request({ path: "/x" })).toEqual({ error: { code: "FORBIDDEN", details: { a: 1 } } });
  });

  test("a non-JSON answer is INVALID_RESPONSE, an empty one is {}", async () => {
    const h = createThemeHost({ event: eventFor(null, null) });

    apiResult = "<html>";
    expect(await h.request({ path: "/x" })).toEqual({ error: { code: "INVALID_RESPONSE" } });
    apiResult = "";
    expect(await h.request({ path: "/x" })).toEqual({});
  });

  test("blob answers pass through", async () => {
    const h = createThemeHost({ event: eventFor(null, null) });
    apiResult = new Blob(["abc"]);

    expect(await h.request({ path: "/file", blob: true })).toBeInstanceOf(Blob);
    expect(calls.api[0].blob).toBe(true);
  });
});

describe("browser host", () => {
  beforeEach(() => setEnvironment(true));

  test("session() follows the bound store and onSession fires on first bind, login and logout", () => {
    const session = writable({ user: null, csrfToken: "t0", siteInfo: {} });
    const h = createThemeHost();
    const seen = [];
    const stop = h.onSession((s) => seen.push(s));

    expect(h.session()).toEqual({ user: null, csrfToken: null });

    const unbind = bindControllerSession(session);
    expect(seen).toEqual([{ user: null, csrfToken: "t0" }]);
    expect(h.session()).toEqual({ user: null, csrfToken: "t0" });
    expect(h.browser).toBe(true);

    // login
    session.set({ user: { id: 1, username: "ada" }, csrfToken: "t1", siteInfo: {} });
    expect(seen.at(-1)).toEqual({ user: { id: 1, username: "ada" }, csrfToken: "t1" });
    expect(h.session().user.id).toBe(1);

    // same user, refreshed siteInfo / token: no notification
    const count = seen.length;
    session.set({ user: { id: 1, username: "ada" }, csrfToken: "t2", siteInfo: { x: 1 } });
    expect(seen.length).toBe(count);
    expect(h.session().csrfToken).toBe("t2");

    // logout
    session.set({ user: null, csrfToken: "t3", siteInfo: {} });
    expect(seen.at(-1)).toEqual({ user: null, csrfToken: "t3" });

    stop();
    session.set({ user: { id: 9 }, csrfToken: "t4", siteInfo: {} });
    expect(seen.at(-1).user).toBeNull();

    unbind();
    session.set({ user: { id: 10 }, csrfToken: "t5", siteInfo: {} });
    expect(h.session().user.id).toBe(9);
  });

  test("binding again replaces the previous binding", () => {
    const first = writable({ user: { id: 1 }, csrfToken: "a" });
    const second = writable({ user: { id: 2 }, csrfToken: "b" });
    const h = createThemeHost();

    bindControllerSession(first);
    bindControllerSession(second);
    first.set({ user: { id: 3 }, csrfToken: "c" });

    expect(h.session().user.id).toBe(2);
  });

  test("a failing listener does not stop the others", () => {
    const h = createThemeHost();
    const seen = [];
    h.onSession(() => {
      throw new Error("listener");
    });
    h.onSession((s) => seen.push(s));
    const original = console.error;
    console.error = () => {};
    try {
      bindControllerSession({ user: { id: 1 }, csrfToken: "x" });
    } finally {
      console.error = original;
    }

    expect(seen).toHaveLength(1);
  });

  test("request sends the bound CSRF token and does not need an event", async () => {
    bindControllerSession(writable({ user: { id: 1 }, csrfToken: "browser-token" }));
    const h = createThemeHost();
    await h.request({ method: "DELETE", path: "/cart/items/1" });

    expect(calls.api[0]).toMatchObject({ csrfToken: "browser-token", request: undefined, data: { method: "DELETE" } });
  });

  test("toast and navigate reach the page; navigate follows the route config", async () => {
    const h = createThemeHost();

    h.toast("plain", { variant: "success", values: { n: 1 } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls.toasts).toEqual([["plain", { n: 1 }, undefined, { variant: "success" }]]);

    h.navigate("/store");
    h.navigate("/store/vip", { replace: true });
    expect(calls.gotos).toEqual([
      { url: "/store", options: undefined },
      { url: "/store/vip", options: { replaceState: true } },
    ]);
  });
});

describe("the rest of the host", () => {
  test("t reads the full key from svelte-i18n, locale the current locale", () => {
    const h = createThemeHost({ event: eventFor(null, null) });

    expect(h.t("plugins.pano-plugin-market.hello", { name: "Ada" })).toBe("Hello Ada");
    expect(h.t("plain")).toBe("Plain");
    expect(h.locale()).toBe(get(locale));
  });

  test("feature, loginUrl and registerUrl run over the theme's pano api and route()", () => {
    const h = createThemeHost({ event: eventFor(null, null) });

    expect(h.feature("named-views")).toBe(true);
    expect(h.feature("nope")).toBe(false);
    expect(h.loginUrl("/cart")).toBe("/login?redirect=/cart");
    expect(h.registerUrl("/cart")).toBe("/register?redirect=%2Fcart");
    expect(h.registerUrl()).toBe("/register");
    // an unsafe return target falls back
    expect(h.registerUrl("//evil.test")).toBe("/register");

    setRouteConfig({ routes: { rename: { "/register": "/join" } } });
    expect(h.registerUrl("/cart")).toBe("/join?redirect=%2Fcart");
  });

  test("now is the clock", () => {
    const before = Date.now();
    const value = createThemeHost({ event: eventFor(null, null) }).now();

    expect(value).toBeGreaterThanOrEqual(before);
  });
});
