import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writable } from "svelte/store";

import { findSvelte, renderSvelte } from "./svelteSsr.helper.js";


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

const lib = join(import.meta.dir, "..");
const pkg = join(lib, "..", "..");
const sdkCore = join(pkg, "..", "sdk", "core", "js");
const read = (...parts) => readFileSync(join(...parts), "utf-8");
const svelteDir = findSvelte();

describe("pano.features (spec 15 section 4.1, theme ids)", () => {
  test("lists exactly the theme ids", async () => {
    const { panoApi, THEME_FEATURE_IDS } = await import("../PluginAPI.js");

    const expected = [
      "context-components",
      "decoded-route-params",
      "layout-route-params",
      "login-return-url",
      "page-meta",
      "page-sidebar-id",
      "page-title-options",
      "plugin-notifications",
      "profile-nav",
      "toast-escaped-values",
    ];

    expect(panoApi.features.list()).toEqual(expected);
    expect(THEME_FEATURE_IDS.length).toBe(expected.length);
    expect(Object.isFrozen(panoApi.features)).toBe(true);
  });

  test("ids that belong to the panel only are not announced by the theme", async () => {
    const { panoApi } = await import("../PluginAPI.js");

    for (const id of ["player-detail-menu", "panel-auth-util", "permission-any-of"]) {
      expect(panoApi.features.has(id)).toBe(false);
    }
  });
});

describe("pano.ui additions", () => {
  test("pano.ui.profile.nav has edit and get; pano.ui.notification.onClick exists", async () => {
    const { panoApi } = await import("../PluginAPI.js");

    expect(typeof panoApi.ui.profile.nav.edit).toBe("function");
    expect(typeof panoApi.ui.profile.nav.get).toBe("function");
    expect(typeof panoApi.ui.notification.onClick).toBe("function");
    // existing profile slots are still there
    expect(typeof panoApi.ui.profile.content.edit).toBe("function");
    expect(typeof panoApi.ui.profile.cardRows.edit).toBe("function");
  });

  test("profile.nav.edit writes the profile-nav slot (source)", () => {
    const source = read(lib, "PluginAPI.js");

    expect(source).toMatch(/nav:\s*\{\s*edit\(callback\)\s*\{\s*slots\.edit\("profile-nav", callback\);/);
    expect(source).toContain('panoApi.ui.view.get("profile-nav")');
  });

  test("notification.onClick registers a plugin listener that onNotificationClick runs after core ones", async () => {
    const { panoApi, init } = await import("../PluginAPI.js");
    const manager = await import(join(sdkCore, "NotificationManager.js"));
    const seen = [];

    panoApi.ui.notification.onClick("TC03_TYPE", (n) => seen.push(n.id));
    manager.onNotificationClick({ id: 7, type: "TC03_TYPE" });
    expect(seen).toEqual([7]);

    // a listener suppresses the href fallback
    const navigated = [];
    manager.onNotificationClick({ id: 8, type: "TC03_TYPE", details: { href: "/x" } }, (p) => navigated.push(p));
    expect(navigated).toEqual([]);
    // without a listener the safe href navigates
    manager.onNotificationClick({ id: 9, type: "TC03_OTHER", details: { href: "/orders/1" } }, (p) => navigated.push(p));
    expect(navigated).toEqual(["/orders/1"]);

    // the host init() resets the plugin listeners
    await init();
    manager.onNotificationClick({ id: 10, type: "TC03_TYPE" });
    expect(seen).toEqual([7, 8]);
  });
});

describe("source wiring", () => {
  test("PluginAPI init resets plugin notification listeners", () => {
    expect(read(lib, "PluginAPI.js")).toMatch(/lifecycle\.reset\(\);\s*resetPluginListeners\(\);/);
  });

  test("Page.svelte resolves the string sidebar after the lifted keys, before returning", () => {
    const source = read(pkg, "src", "routes", "plugin-ui", "Page.svelte");

    expect(source).toContain("resolveSidebarSpec");
    expect(source.indexOf("for (const key of")).toBeLessThan(source.indexOf("await resolveSidebarSpec"));
    expect(source.indexOf("await resolveSidebarSpec")).toBeLessThan(source.lastIndexOf("return output;"));
    expect(source).toContain("HomeSidebar.svelte");
    expect(source).toContain("ProfileSidebar.svelte");
    expect(source).toContain("PluginSidebar.svelte");
    expect(source).toContain("get(panoApi.ui.sidebar.get(sidebarId)).length");
  });

  test("ProfileSidebar registers the profile-nav item (priority 95), merges the built-ins and renders the card", () => {
    const source = read(lib, "components", "sidebars", "ProfileSidebar.svelte");

    expect(source).toMatch(/id: "profile-nav",\s*component: "local:profile-nav",\s*priority: 95/);
    expect(source).toContain("panoApi.ui.profile.nav.edit");
    expect(source).toContain("mergeProfileNav(navItems)");
    expect(source).toContain('item.id === "profile-nav"');
    expect(source).toContain("<ProfileNavCard entries={navEntries} />");
    expect(source).toContain("panoApi.ui.profile.nav.get()");
  });

  test("AppLayoutLogics completes the context (T9)", () => {
    const source = read(lib, "ui-logics", "layout-logics", "AppLayoutLogics.js");

    expect(source).toMatch(/import \{ goto, invalidate, invalidateAll \} from "\$app\/navigation"/);
    expect(source).toMatch(/goto,\s*invalidate,\s*invalidateAll,\s*error,\s*redirect,/);
    for (const name of ["Toast", "Sidebar", "ViewComponent", "Hook"]) {
      expect(source).toMatch(new RegExp(`import ${name} from "\\$pano/lib/components/${name}\\.svelte"`));
      expect(source).toMatch(new RegExp(`PlayerHead: ResolvedPlayerHead,[\\s\\S]*\\b${name},[\\s\\S]*\\},\\s*utils:`));
    }
  });

  test("NotificationsView renders through notificationTextKey with the UNKNOWN default and the href navigator", () => {
    const source = read(lib, "views", "NotificationsView.svelte");

    expect(source).toContain("notificationTextKey(notification)");
    expect(source).toContain('default: $_("notifications.UNKNOWN")');
    expect(source).toContain("onNotificationClick(notification, navigate)");
    expect(source).toContain("goto(base + path)");
    expect(source).not.toContain('"notifications." + notification.type');
  });

  test("NotificationContainer pop-up uses notificationTextKey, the UNKNOWN default and the href navigator", () => {
    const source = read(lib, "components", "NotificationContainer.svelte");

    expect(source).toContain("notificationTextKey(notification)");
    expect(source).toContain("notifications.UNKNOWN");
    expect(source).toContain("goto(base + path)");
    expect(source).not.toContain("'notifications.' + notification.type");
    expect(source).not.toMatch(/onNotificationClick\(notification\)/);
    expect(source.match(/onNotificationClick\(notification, navigate\)/g)?.length).toBe(2);
  });

  test("skin-contract lists the profile-nav slot", () => {
    const contract = JSON.parse(read(pkg, "skin-contract.json"));

    expect(contract.view_slots).toContain("profile-nav");
    expect(contract.views.NotificationsView.props.onNotificationClick).toContain("navigate");
  });

  test("notifications.UNKNOWN exists in all three locales", () => {
    for (const locale of ["en-US", "tr", "ru"]) {
      const messages = JSON.parse(read(pkg, "lang", `${locale}.json`));
      expect(typeof messages.notifications.UNKNOWN).toBe("string");
      expect(messages.notifications.UNKNOWN.length).toBeGreaterThan(5);
    }
  });
});

describe.skipIf(!svelteDir)("server render", () => {
  const sidebars = join(lib, "components", "sidebars");
  const html = join(sdkCore, "html.util.js");

  const i18nStub = `
    import { readable } from "svelte/store";
    export const _ = readable((text, options = {}) =>
      String(text).replace(/\\{(\\w+)\\}/g, (m, k) => (options.values && k in options.values ? options.values[k] : m)));
  `;

  test("ProfileNavCard renders list-group links, the active one, icon and badge", async () => {
    const { body } = await renderSvelte({
      svelteDir,
      components: { "#card": join(sidebars, "ProfileNavCard.svelte") },
      props: {
        entries: [
          { id: "profile", href: "/profile", text: "Profile", icon: "fas fa-user", badge: null, active: false },
          { id: "orders", href: "/profile/orders", text: "Orders", icon: null, badge: "3", active: true },
        ],
      },
    });

    expect(body).toContain('<div class="card"><div class="list-group list-group-flush">');
    expect(body.match(/list-group-item list-group-item-action d-flex align-items-center/g).length).toBe(2);
    expect(body).toMatch(/class="list-group-item list-group-item-action d-flex align-items-center active"[^>]*href="\/profile\/orders"/);
    expect(body).toContain('aria-current="page"');
    expect(body.match(/aria-current/g).length).toBe(1);
    expect(body).toContain('<span class="badge text-bg-primary ms-auto">3</span>');
    expect(body).toContain("fas fa-user");
  });

  test("ProfileNavCard escapes text coming from a plugin", async () => {
    const { body } = await renderSvelte({
      svelteDir,
      components: { "#card": join(sidebars, "ProfileNavCard.svelte") },
      props: {
        entries: [{ id: "x", href: "/x", text: "<img src=x onerror=alert(1)>", icon: null, badge: null, active: false }],
      },
    });

    expect(body).not.toContain("<img");
    expect(body).toContain("&lt;img");
  });

  async function renderPluginSidebar(items, props = {}) {
    return renderSvelte({
      svelteDir,
      components: {
        "$pano/lib/components/sidebars/PluginSidebar.svelte": join(sidebars, "PluginSidebar.svelte"),
        "$pano/lib/components/Sidebar.svelte": join(lib, "components", "Sidebar.svelte"),
        "$pano/lib/components/ViewComponent.svelte": join(lib, "components", "ViewComponent.svelte"),
        "$pano/lib/components/Probe.svelte": join(import.meta.dir, "fixtures", "Probe.svelte"),
      },
      modules: {
        "$pano/lib/PluginAPI": `
          import { readable } from "svelte/store";
          import Probe from "$pano/lib/components/Probe.svelte";
          const all = ${JSON.stringify(items)};
          export const panoApi = { ui: { sidebar: { get: (id) => readable(all.filter((i) => i.sidebarId === id).map((i) => ({ ...i, component: { default: Probe } }))) } } };
        `,
      },
      props,
    });
  }

  test("PluginSidebar renders the slot items inside an aside in a vstack", async () => {
    const { body } = await renderPluginSidebar(
      [
        { sidebarId: "fixture", id: "one", props: { label: "First" } },
        { sidebarId: "fixture", id: "two", props: { label: "Second" } },
        { sidebarId: "other", id: "three", props: { label: "Other slot" } },
      ],
      { sidebarId: "fixture", side: "left" },
    );

    expect(body).toContain('<aside class="col-lg-4 order-first order-lg-first">');
    expect(body).toContain('<div class="vstack gap-3">');
    expect(body).toContain("First");
    expect(body).toContain("Second");
    expect(body).not.toContain("Other slot");
    expect(body.indexOf("First")).toBeLessThan(body.indexOf("Second"));
  });

  test("PluginSidebar defaults to the right side", async () => {
    const { body } = await renderPluginSidebar([{ sidebarId: "fixture", id: "one", props: { label: "First" } }], {
      sidebarId: "fixture",
    });

    expect(body).toContain('class="col-lg-4 order-first order-lg-last"');
  });

  test("DefaultToast escapes markup in values but keeps markup of the locale string", async () => {
    const { body } = await renderSvelte({
      svelteDir,
      components: {
        "#toast": join(lib, "components", "DefaultToast.svelte"),
        "$pano/lib/components/Toast.svelte": join(lib, "components", "Toast.svelte"),
      },
      modules: {
        "svelte-i18n": i18nStub,
        "@panomc/sdk/core/js/html.util.js": `export * from ${JSON.stringify(html)};`,
      },
      props: { id: 1, text: "<b>Hello</b> {name}", values: { name: "<img src=x onerror=alert(1)>", n: 4 } },
    });

    expect(body).toContain("<b>Hello</b>");
    expect(body).not.toContain("<img");
    expect(body).toContain("&amp;lt;img src=x onerror=alert(1)&amp;gt;".replace(/&amp;/g, "&"));
    expect(body).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  test("DefaultToast without values renders", async () => {
    const { body } = await renderSvelte({
      svelteDir,
      components: {
        "#toast": join(lib, "components", "DefaultToast.svelte"),
        "$pano/lib/components/Toast.svelte": join(lib, "components", "Toast.svelte"),
      },
      modules: {
        "svelte-i18n": i18nStub,
        "@panomc/sdk/core/js/html.util.js": `export * from ${JSON.stringify(html)};`,
      },
      props: { id: 2, text: "Plain", values: undefined, variant: "success" },
    });

    expect(body).toContain("Plain");
    expect(body).toContain("text-success");
  });
});

describe("TC-9 fixture plugin (test-fixtures, run in E2E-19)", () => {
  const fixture = join(pkg, "..", "..", "test-fixtures", "tc9-fixture-plugin");
  const readFixture = (...parts) => readFileSync(join(fixture, ...parts), "utf-8");

  test("main.js is a short plugin that registers the seven check pages and both sidebars", () => {
    const source = readFixture("src", "main.js");

    expect(source.split("\n").length).toBeLessThanOrEqual(60);
    for (const path of [
      "/fixture/login-required",
      "/fixture/hook",
      "/fixture/meta",
      "/profile/fixture",
      "/fixture/sidebar-empty",
      "/fixture/sidebar-one",
      "/fixture/toast",
      "/fixture/title",
    ]) {
      expect(source).toContain(`path: '${path}'`);
    }
    expect(source).toContain("loginRequired: true");
    expect(source).toContain("systemLayout: 'ProfileLayout'");
    expect(source).toContain("sidebarId: 'fixture', id: 'fixture-card'");
    expect(source).toContain("startsWith: true");
  });

  test("Page.svelte returns the keys the host lifts for every check", () => {
    const source = readFixture("src", "Page.svelte");

    expect(source).toContain("sidebar: 'profile'");
    expect(source).toContain("sidebar: 'plugin:fixture-empty'");
    expect(source).toContain("sidebar: 'plugin:fixture'");
    expect(source).toContain("pageTitle: { title: 'buttons.save', raw: true, hidden: true }");
    expect(source).toContain("meta: {");
    expect(source).toContain("<img src=x onerror=alert(1)>");
    expect(source).toContain("context.components?.Hook");
  });

  test("README lists all seven checks and the ten theme feature ids", () => {
    const readme = readFixture("README.md");

    for (let i = 1; i <= 7; i++) expect(readme).toContain(`| ${i} |`);
    for (const id of [
      "context-components",
      "decoded-route-params",
      "layout-route-params",
      "login-return-url",
      "page-meta",
      "page-sidebar-id",
      "page-title-options",
      "plugin-notifications",
      "profile-nav",
      "toast-escaped-values",
    ]) {
      expect(readme).toContain("`" + id + "`");
    }
  });

  test("the locale file carries the toast key with a {value} placeholder", () => {
    expect(JSON.parse(readFixture("src", "locales", "en-US.json")).toast).toContain("{value}");
  });

  test.skipIf(!svelteDir)("both fixture components compile with the svelte compiler", async () => {
    const compiler = await import(join(svelteDir, "src", "compiler", "index.js"));

    for (const file of ["Page.svelte", "SidebarItem.svelte"]) {
      for (const generate of ["client", "server"]) {
        expect(() => compiler.compile(readFixture("src", file), { generate, filename: file })).not.toThrow();
      }
    }
  });
});
