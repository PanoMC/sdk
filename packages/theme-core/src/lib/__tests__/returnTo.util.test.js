import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { writable } from "svelte/store";

// The SvelteKit aliases and peer packages are not installed in this repo: stub exactly what
// Store.js and PluginAPI.js import, with SvelteKit's real `redirect` shape.
class Redirect {
  constructor(status, location) {
    this.status = status;
    this.location = location;
  }
}
mock.module("@sveltejs/kit", () => ({
  redirect: (status, location) => new Redirect(status, location),
}));
mock.module("$app/paths", () => ({ base: "" }));
mock.module("$app/environment", () => ({ browser: false }));
mock.module("$app/navigation", () => ({ goto: async () => {} }));
mock.module("$pano/lib/services/auth.js", () => ({ sendLogout: async () => {} }));
mock.module("$pano/lib/components/ToastContainer.svelte", () => ({ showSuccess: async () => {} }));
mock.module("$pano/lib/returnTo.util.js", () => import("../returnTo.util.js"));
mock.module("@panomc/sdk/core/js/PluginAPI", () =>
  import("../../../../sdk/core/js/PluginAPI.js"),
);
// Superset of what the sdk tests mock for the same file (bun mocks are process-wide).
const pluginManagerStub = () => ({
  plugins: writable([]),
  registeredPages: {},
  findMatch: () => null,
});
mock.module("@panomc/sdk/core/js/PluginManager.js", pluginManagerStub);
mock.module(new URL("../../../../sdk/core/js/PluginManager.js", import.meta.url).pathname, pluginManagerStub);
mock.module("$pano/plugin-engine/engine.js", () => ({
  createHookEngine: () => ({ reset() {}, executeHookLoad() {}, register() {}, get() {}, setVisible() {} }),
  createLifecycleRegistry: () => ({ reset() {}, executeLifecycle() {}, on() {} }),
  createSlotRegistry: () => ({
    reset() {},
    executeSidebarLoad() {},
    executeViewLoad() {},
    edit() {},
    upsert() {},
    get() {},
  }),
}));

import {
  buildLoginUrl,
  loginRedirectFor,
  returnToFromUrl,
  sanitizeReturnTo,
} from "../returnTo.util.js";

const ORIGIN = "https://pano.example";

describe("sanitizeReturnTo (TC-1)", () => {
  test("accepted targets keep path, query and hash", () => {
    expect(sanitizeReturnTo("/store/checkout?x=1#a")).toBe("/store/checkout?x=1#a");
    expect(sanitizeReturnTo("/profile/orders")).toBe("/profile/orders");
    expect(sanitizeReturnTo("/")).toBe("/");
    expect(sanitizeReturnTo("/loginx")).toBe("/loginx");
    expect(sanitizeReturnTo("/store/a%20b?q=%2F")).toBe("/store/a%20b?q=%2F");
  });

  test("accepted target of exactly 2048 characters", () => {
    const value = "/" + "a".repeat(2047);
    expect(value.length).toBe(2048);
    expect(sanitizeReturnTo(value)).toBe(value);
  });

  test("rejected targets fall back", () => {
    const rejected = [
      "//evil.com",
      "/\\evil",
      "https://evil.com",
      "javascript:alert(1)",
      "/a\\b",
      "/a\nb",
      "/a\tb",
      "/a\x00b",
      "/a\x7fb",
      "/" + "a".repeat(2048),
      "",
      "evil",
      "/login",
      "/login/x",
      "/login?x=1",
      "/register?redirect=/",
      "/reset-password",
      "/renew-password/abc",
      "/activate",
      "/activate/code",
      "/activate-new-email",
      "/activate-new-email/code",
      "/%6Cogin",
      "/foo/../login",
      "/LOGIN",
      "/.//evil.com",
      "/x/..//evil.com",
      "/%2e//evil.com",
      "/%2E%2E//evil.com",
      "/.//login",
    ];

    for (const value of rejected) {
      expect(sanitizeReturnTo(value)).toBe("/");
      expect(sanitizeReturnTo(value, "/home")).toBe("/home");
    }
  });

  test("non-strings fall back", () => {
    for (const value of [null, undefined, 1, {}, [], ["/a"], true]) {
      expect(sanitizeReturnTo(value)).toBe("/");
      expect(sanitizeReturnTo(value, "/x")).toBe("/x");
    }
  });
});

describe("buildLoginUrl / returnToFromUrl (TC-1)", () => {
  test("root and unsafe targets give a plain login url", () => {
    expect(buildLoginUrl("/")).toBe("/login");
    expect(buildLoginUrl(undefined)).toBe("/login");
    expect(buildLoginUrl("//evil.com")).toBe("/login");
    expect(buildLoginUrl("/login")).toBe("/login");
  });

  test("encodes the target", () => {
    expect(buildLoginUrl("/store/checkout?x=1#a")).toBe(
      "/login?redirect=" + encodeURIComponent("/store/checkout?x=1#a"),
    );
  });

  test("round trip", () => {
    for (const p of ["/store/checkout?x=1", "/store/a-b", "/p?x=1&y=2", "/a/b/c?d=%2F"]) {
      expect(returnToFromUrl(new URL(buildLoginUrl(p), ORIGIN))).toBe(p);
    }
  });

  test("round trip keeps the fragment", () => {
    const p = "/store/checkout?x=1#a";
    expect(returnToFromUrl(new URL(buildLoginUrl(p), ORIGIN))).toBe(p);
  });

  test("returnToFromUrl falls back on a missing or unsafe redirect", () => {
    expect(returnToFromUrl(new URL("/login", ORIGIN))).toBe("/");
    expect(returnToFromUrl(new URL("/login", ORIGIN), "/home")).toBe("/home");
    expect(returnToFromUrl(new URL("/login?redirect=//evil.com", ORIGIN))).toBe("/");
    expect(returnToFromUrl(new URL("/login?redirect=https%3A%2F%2Fevil.com", ORIGIN))).toBe("/");
    expect(returnToFromUrl(new URL("/login?redirect=%2Flogin", ORIGIN))).toBe("/");
    expect(returnToFromUrl(undefined)).toBe("/");
    expect(returnToFromUrl(null, "/z")).toBe("/z");
    expect(returnToFromUrl({})).toBe("/");
  });

  test("returnToFromUrl accepts a string url", () => {
    expect(returnToFromUrl("/login?redirect=%2Fstore")).toBe("/store");
  });
});

describe("loginRedirectFor", () => {
  const url = { pathname: "/store/checkout", search: "?a=1" };

  test("guest on a loginRequired page is redirected, with or without a permission", () => {
    const expected = "/login?redirect=" + encodeURIComponent("/store/checkout?a=1");
    expect(loginRedirectFor({ loginRequired: true }, null, url)).toBe(expected);
    expect(loginRedirectFor({ loginRequired: true, permission: "x" }, undefined, url)).toBe(expected);
  });

  test("no redirect for a logged in user or a public page", () => {
    expect(loginRedirectFor({ loginRequired: true }, { id: 1 }, url)).toBeNull();
    expect(loginRedirectFor({}, null, url)).toBeNull();
    expect(loginRedirectFor(null, null, url)).toBeNull();
  });

  test("missing search is tolerated", () => {
    expect(loginRedirectFor({ loginRequired: true }, null, { pathname: "/x" })).toBe(
      "/login?redirect=%2Fx",
    );
  });

  test("plugin-ui Layout runs the login redirect before the permission check", () => {
    const src = readFileSync(
      new URL("../../routes/plugin-ui/Layout.svelte", import.meta.url),
      "utf8",
    );
    const login = src.indexOf("loginRedirectFor(registeredPage");
    const permission = src.indexOf("registeredPage.permission &&");
    expect(login).toBeGreaterThan(-1);
    expect(permission).toBeGreaterThan(-1);
    expect(login).toBeLessThan(permission);
  });

  test("plugin-ui Layout passes the page params to the system layout and layout loads", () => {
    const src = readFileSync(
      new URL("../../routes/plugin-ui/Layout.svelte", import.meta.url),
      "utf8",
    );
    const merge = src.indexOf("event.params = { ...event.params, ...registeredPage.params }");
    const systemLoad = src.indexOf("systemLayoutModule.load(event)");
    const layoutLoad = src.indexOf("layout.load(event)");
    expect(merge).toBeGreaterThan(-1);
    expect(merge).toBeLessThan(systemLoad);
    expect(merge).toBeLessThan(layoutLoad);
  });
});

describe("Store requireLogin / requireNotLogin", () => {
  async function redirectOf(fn) {
    try {
      fn();
    } catch (e) {
      return e;
    }
    return null;
  }

  test("guest with a load event is redirected to login with the target", async () => {
    const { requireLogin } = await import("../Store.js");
    const url = new URL("/profile/orders?page=2", ORIGIN);
    const e = await redirectOf(() => requireLogin({ user: null }, { url }));
    expect(e.status).toBe(302);
    expect(e.location).toBe("/login?redirect=" + encodeURIComponent("/profile/orders?page=2"));
  });

  test("a string target keeps the old behaviour", async () => {
    const { requireLogin } = await import("../Store.js");
    const e = await redirectOf(() => requireLogin({ user: null }, "/elsewhere"));
    expect(e.location).toBe("/elsewhere");
    const d = await redirectOf(() => requireLogin({ user: null }));
    expect(d.location).toBe("/login");
  });

  test("logged in user passes requireLogin", async () => {
    const { requireLogin } = await import("../Store.js");
    expect(await redirectOf(() => requireLogin({ user: { id: 1 } }, { url: new URL("/x", ORIGIN) }))).toBeNull();
  });

  test("requireNotLogin returns to ?redirect= or /", async () => {
    const { requireNotLogin } = await import("../Store.js");
    const withTarget = await redirectOf(() =>
      requireNotLogin({ user: { id: 1 } }, { url: new URL("/login?redirect=%2Fstore%2Fcheckout", ORIGIN) }),
    );
    expect(withTarget.location).toBe("/store/checkout");

    const evil = await redirectOf(() =>
      requireNotLogin({ user: { id: 1 } }, { url: new URL("/login?redirect=%2F%2Fevil.com", ORIGIN) }),
    );
    expect(evil.location).toBe("/");

    const dotted = await redirectOf(() =>
      requireNotLogin({ user: { id: 1 } }, { url: new URL("/login?redirect=%2F.%2F%2Fevil.com", ORIGIN) }),
    );
    expect(dotted.location).toBe("/");

    expect(returnToFromUrl(new URL("https://site/login?redirect=/.//evil.com"))).toBe("/");

    const none = await redirectOf(() => requireNotLogin({ user: { id: 1 } }));
    expect(none.location).toBe("/");

    expect(await redirectOf(() => requireNotLogin({ user: null }, { url: new URL("/login", ORIGIN) }))).toBeNull();
  });
});

describe("pano.auth (T2)", () => {
  test("exposes loginUrl, returnTo and requireLogin; features announce the ids", async () => {
    const { panoApi, THEME_FEATURE_IDS } = await import("../PluginAPI.js");
    expect(Object.keys(panoApi.auth).sort()).toEqual(["loginUrl", "requireLogin", "returnTo"]);
    expect(panoApi.auth.loginUrl("/store/checkout")).toBe(
      "/login?redirect=" + encodeURIComponent("/store/checkout"),
    );
    expect(panoApi.auth.loginUrl("//evil.com")).toBe("/login");
    expect(panoApi.auth.returnTo(new URL("/login?redirect=%2Fstore", ORIGIN))).toBe("/store");
    expect(panoApi.auth.returnTo(new URL("/login", ORIGIN))).toBe("/");
    expect(panoApi.features.has("login-return-url")).toBe(true);
    expect(panoApi.features.has("layout-route-params")).toBe(true);
    expect(panoApi.features.list()).toEqual([...THEME_FEATURE_IDS].sort());
    expect(typeof panoApi.ui.auth.login.content.edit).toBe("function");
  });

  test("requireLogin redirects a guest and lets a user through", async () => {
    const { panoApi } = await import("../PluginAPI.js");
    const url = new URL("/store/checkout?x=1", ORIGIN);

    let thrown = null;
    try {
      await panoApi.auth.requireLogin({ url, parent: async () => ({ session: { user: null } }) });
    } catch (e) {
      thrown = e;
    }
    expect(thrown.status).toBe(302);
    expect(thrown.location).toBe("/login?redirect=" + encodeURIComponent("/store/checkout?x=1"));

    await panoApi.auth.requireLogin({ url, parent: async () => ({ session: { user: { id: 1 } } }) });
  });
});
