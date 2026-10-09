import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readable } from "svelte/store";

import { findSvelte } from "./svelteSsr.helper.js";
import { buildCases, renderPart } from "./engineParts.helper.js";

// TC-51: the home page setting (resolveHome and its fallbacks, the plugin page served at `/`), the
// `/posts` route, and `route()` in the default views.

// bun mocks are process-wide: every stub is a superset of what the other suites use
mock.module("$app/environment", () => ({ browser: false, dev: false }));
mock.module("@sveltejs/kit", () => ({
  error: (status, message) => Object.assign(new Error(`HTTP ${status} ${message ?? ""}`), { status }),
  redirect: (status, location) => Object.assign(new Error("redirect"), { status, location, redirect: true }),
}));

const registry = await import("../../registry/index.js");
const routes = await import("../../registry/routes.js");
const { resolveHome, resolveHomeFor, isPostsRoute, homeIsPosts, postsPath } = await import("../home.js");
const { loadHomeTarget } = await import("../../routes/plugin-ui/load.js");

const pkgDir = join(import.meta.dir, "..", "..", "..");
const syncJs = join(pkgDir, "bin", "sync.js");
const svelteDir = findSvelte();

beforeEach(() => {
  registry.resetRegistryForTests();
  registry.setThemeConfig({});
  routes.setRouteConfig({});
});

/** A `warn` that remembers what it was told. */
function warnings() {
  const messages = [];
  const warn = (message) => messages.push(message);
  return { messages, warn };
}

const PAGES = {
  "/store": { view: "market:Store", home: { label: "Store" }, name: "store" },
  "/store/[slug]": { view: "market:Product", name: "product" },
  "/rules": { name: "rules" },
  "/account": { name: "account", systemLayout: "ProfileLayout" },
  "/boxed": { name: "boxed", layout: () => ({}) },
};

const THEME = {
  home: {
    default: "landing",
    options: {
      posts: { label: "Posts" },
      landing: { label: "Landing", page: "./src/pages/Landing.svelte" },
      store: { label: "Store", path: "/store" },
      product: { label: "Product", path: "/store/[slug]" },
      custom: { label: "Custom", path: "*" },
    },
  },
};

const HOME_PAGES = { landing: () => Promise.resolve({ default: "<Landing>" }) };

// ---------------------------------------------------------------------------
// resolveHome
// ---------------------------------------------------------------------------

describe("resolveHome", () => {
  test("no home config and no choice: the posts feed, silently", () => {
    const { messages, warn } = warnings();

    expect(resolveHome({}, null, PAGES, { warn })).toEqual({ kind: "posts" });
    expect(resolveHome(undefined, undefined, undefined, { warn })).toEqual({ kind: "posts" });
    expect(resolveHome({}, "posts", PAGES, { warn })).toEqual({ kind: "posts" });
    expect(messages).toEqual([]);
  });

  test("no choice: home.default (a page of the theme, a plugin path, posts)", () => {
    const { messages, warn } = warnings();

    expect(resolveHome(THEME, null, PAGES, { warn, homePages: HOME_PAGES })).toEqual({ kind: "page", id: "landing" });
    expect(resolveHome({ home: { ...THEME.home, default: "store" } }, null, PAGES, { warn })).toEqual({ kind: "path", path: "/store" });
    expect(resolveHome({ home: { ...THEME.home, default: "posts" } }, "", PAGES, { warn })).toEqual({ kind: "posts" });
    expect(messages).toEqual([]);
  });

  test("the admin's choice wins over home.default", () => {
    const { messages, warn } = warnings();

    expect(resolveHome(THEME, "store", PAGES, { warn, homePages: HOME_PAGES })).toEqual({ kind: "path", path: "/store" });
    expect(resolveHome(THEME, "posts", PAGES, { warn, homePages: HOME_PAGES })).toEqual({ kind: "posts" });
    expect(resolveHome(THEME, "landing", PAGES, { warn, homePages: HOME_PAGES })).toEqual({ kind: "page", id: "landing" });
    expect(resolveHome(THEME, "custom:/rules", PAGES, { warn, homePages: HOME_PAGES })).toEqual({ kind: "path", path: "/rules" });
    expect(resolveHome(THEME, "custom:/store/vip", PAGES, { warn, homePages: HOME_PAGES })).toEqual({ kind: "path", path: "/store/vip" });
    expect(resolveHome(THEME, "custom:/posts", PAGES, { warn, homePages: HOME_PAGES })).toEqual({ kind: "posts" });
    expect(messages).toEqual([]);
  });

  test("unknown option id: the default, one warning", () => {
    const { messages, warn } = warnings();

    expect(resolveHome(THEME, "nope", PAGES, { warn, homePages: HOME_PAGES })).toEqual({ kind: "page", id: "landing" });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('"nope"');
  });

  test("plugin not installed: the default, one warning", () => {
    const { messages, warn } = warnings();

    expect(resolveHome(THEME, "store", {}, { warn, homePages: HOME_PAGES })).toEqual({ kind: "page", id: "landing" });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("/store");
  });

  test("a concrete path that matches no registered page: the default, one warning", () => {
    const { messages, warn } = warnings();

    expect(resolveHome(THEME, "custom:/missing", PAGES, { warn, homePages: HOME_PAGES })).toEqual({ kind: "page", id: "landing" });
    expect(messages).toHaveLength(1);
  });

  test("a pattern instead of a concrete path: the default, one warning (/store/vip is fine)", () => {
    const { messages, warn } = warnings();

    expect(resolveHome(THEME, "product", PAGES, { warn, homePages: HOME_PAGES })).toEqual({ kind: "page", id: "landing" });
    expect(resolveHome(THEME, "custom:/store/[slug]", PAGES, { warn, homePages: HOME_PAGES })).toEqual({ kind: "page", id: "landing" });
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("pattern");
    expect(resolveHome(THEME, "custom:/store/vip", PAGES, { warn, homePages: HOME_PAGES })).toEqual({ kind: "path", path: "/store/vip" });
    expect(messages).toHaveLength(2);
  });

  test("a systemLayout page (and a page with its own layout) is refused", () => {
    const { messages, warn } = warnings();

    expect(resolveHome(THEME, "custom:/account", PAGES, { warn, homePages: HOME_PAGES })).toEqual({ kind: "page", id: "landing" });
    expect(resolveHome(THEME, "custom:/boxed", PAGES, { warn, homePages: HOME_PAGES })).toEqual({ kind: "page", id: "landing" });
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("system layout");
  });

  test("a path that is not a site path, and a custom path the theme does not offer", () => {
    const { messages, warn } = warnings();

    expect(resolveHome(THEME, "custom:https://evil.example", PAGES, { warn, homePages: HOME_PAGES })).toEqual({ kind: "page", id: "landing" });
    expect(resolveHome(THEME, "custom://evil.example", PAGES, { warn, homePages: HOME_PAGES })).toEqual({ kind: "page", id: "landing" });
    expect(messages).toHaveLength(2);

    const noCustom = { home: { default: "posts", options: { posts: { label: "Posts" } } } };
    const { messages: more, warn: warnMore } = warnings();
    expect(resolveHome(noCustom, "custom:/rules", PAGES, { warn: warnMore })).toEqual({ kind: "posts" });
    expect(more).toHaveLength(1);
    expect(more[0]).toContain("custom");
  });

  test("a page option whose file the build did not find, and the bare `custom` option", () => {
    const { messages, warn } = warnings();

    expect(resolveHome({ home: { default: "posts", options: THEME.home.options } }, "landing", PAGES, { warn, homePages: {} })).toEqual({ kind: "posts" });
    expect(resolveHome({ home: { default: "posts", options: THEME.home.options } }, "custom", PAGES, { warn, homePages: HOME_PAGES })).toEqual({ kind: "posts" });
    expect(messages).toHaveLength(2);
  });

  test("home.default that cannot be shown: the posts feed, one more warning", () => {
    const { messages, warn } = warnings();

    // the choice fails (1), then the default fails (2), then posts
    expect(resolveHome({ home: { ...THEME.home, default: "store" } }, "nope", {}, { warn })).toEqual({ kind: "posts" });
    expect(messages).toHaveLength(2);
    expect(messages[1]).toContain("home.default");

    // a default that fails with no choice: one warning
    const { messages: alone, warn: warnAlone } = warnings();
    expect(resolveHome({ home: { ...THEME.home, default: "store" } }, null, {}, { warn: warnAlone })).toEqual({ kind: "posts" });
    expect(alone).toHaveLength(1);
  });

  test("a good choice is not warned about even when the default is broken", () => {
    const { messages, warn } = warnings();

    expect(resolveHome({ home: { ...THEME.home, default: "ghost" } }, "store", PAGES, { warn })).toEqual({ kind: "path", path: "/store" });
    expect(messages).toEqual([]);
  });

  test("a theme without a home config: a plugin page that offers itself, by its view id", () => {
    const { messages, warn } = warnings();

    expect(resolveHome({}, "market:Store", PAGES, { warn })).toEqual({ kind: "path", path: "/store" });
    expect(resolveHome({}, "custom:/rules", PAGES, { warn })).toEqual({ kind: "path", path: "/rules" });
    expect(messages).toEqual([]);

    // a page without `view.home`, and a plugin that is not there
    expect(resolveHome({}, "market:Product", PAGES, { warn })).toEqual({ kind: "posts" });
    expect(resolveHome({}, "market:Store", {}, { warn })).toEqual({ kind: "posts" });
    expect(messages).toHaveLength(2);
  });

  test("without a page table the choice is taken as it is", () => {
    expect(resolveHome(THEME, "store", null, { warn: () => {} })).toEqual({ kind: "path", path: "/store" });
    expect(resolveHome({}, "market:Store", null, { warn: () => {} }).kind).toBe("path");
    expect(resolveHome({}, null, null, { warn: () => {} })).toEqual({ kind: "posts" });
  });

  test("the default warn is console.warn", () => {
    const calls = [];
    const original = console.warn;
    console.warn = (...args) => calls.push(args);

    try {
      expect(resolveHome(THEME, "nope", PAGES, { homePages: HOME_PAGES })).toEqual({ kind: "page", id: "landing" });
    } finally {
      console.warn = original;
    }

    expect(calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The route and the load
// ---------------------------------------------------------------------------

describe("isPostsRoute / resolveHomeFor", () => {
  test("the id of the /posts route, whatever its group", () => {
    expect(isPostsRoute({ route: { id: "/(theme)/posts" } })).toBe(true);
    expect(isPostsRoute({ route: { id: "/posts" } })).toBe(true);
    expect(isPostsRoute({ route: { id: "/(theme)" } })).toBe(false);
    expect(isPostsRoute({ route: { id: "/(theme)/post/[url]" } })).toBe(false);
    expect(isPostsRoute({ route: { id: "/(theme)/posts/[x]" } })).toBe(false);
    expect(isPostsRoute({})).toBe(false);
    expect(isPostsRoute(undefined)).toBe(false);
  });

  test("/posts is the feed and never waits for the layout; / follows the setting", async () => {
    registry.setThemeConfig(THEME);
    registry.setThemeMeta({ refs: {}, claims: [], homePages: HOME_PAGES });
    let waited = 0;
    const parent = async () => {
      waited++;
      return { session: { siteInfo: { homePage: "store" } } };
    };

    expect(await resolveHomeFor({ route: { id: "/(theme)/posts" }, parent }, () => PAGES)).toEqual({ kind: "posts" });
    expect(waited).toBe(0);

    expect(await resolveHomeFor({ route: { id: "/(theme)" }, parent }, () => PAGES)).toEqual({ kind: "path", path: "/store" });
    expect(waited).toBe(1);

    // no choice: the default; the table is read when the load runs
    const noChoice = { route: { id: "/(theme)" }, parent: async () => ({ session: { siteInfo: { homePage: null } } }) };
    expect(await resolveHomeFor(noChoice, () => PAGES)).toEqual({ kind: "page", id: "landing" });
  });
});

describe("posts feed links", () => {
  test("`/` while the feed is the home page, `/posts` otherwise, through route()", () => {
    expect(homeIsPosts(undefined)).toBe(true);
    expect(postsPath({ homePage: null })).toBe("/");

    registry.setThemeConfig(THEME);
    expect(homeIsPosts({ homePage: "posts" })).toBe(true);
    expect(postsPath({ homePage: "posts" })).toBe("/");
    expect(postsPath({ homePage: "store" })).toBe("/posts");
    expect(postsPath({ homePage: null })).toBe("/posts"); // home.default = landing

    routes.setRouteConfig({ routes: { rename: { "/posts": "/news" } } });
    expect(postsPath({ homePage: "store" })).toBe("/news");
    expect(postsPath({ homePage: "posts" })).toBe("/");
  });

  test("never warns while rendering", () => {
    registry.setThemeConfig(THEME);
    const original = console.warn;
    let count = 0;
    console.warn = () => count++;

    try {
      postsPath({ homePage: "nope" });
      postsPath({ homePage: "custom:/x" });
    } finally {
      console.warn = original;
    }

    expect(count).toBe(0);
  });
});

describe("loadHomeTarget", () => {
  const guest = { session: { user: null } };
  const sidebar = { hosts: { home: {}, profile: {} }, PluginSidebar: {}, executeSidebarLoad: async () => {}, countVisible: () => 0 };
  const event = (parentData = guest) => ({
    parent: async () => parentData,
    url: new URL("http://localhost/"),
    params: {},
  });
  const deps = (pages, extra = {}) => ({
    sidebar,
    hasPermission: () => true,
    findPage: (path) => (pages[path] ? { ...pages[path], params: {} } : null),
    ...extra,
  });

  const page = (extra = {}) => ({
    component: async () => ({ default: "<StorePage>", load: async () => ({ pageTitle: "store.title", products: 3 }) }),
    ...extra,
  });

  test("a plugin page: its load output, the layout fields, and meta.canonical = /", async () => {
    const out = await loadHomeTarget(event(), { kind: "path", path: "/store" }, deps({ "/store": page() }));

    expect(out.homeKind).toBe("path");
    expect(out.component.default).toBe("<StorePage>");
    expect(out.props).toEqual({ pageTitle: "store.title", products: 3 });
    expect(out.pageTitle).toBe("store.title");
    expect(out.viewSource).toBe("default");
    expect(out.meta).toEqual({ canonical: "/" });
  });

  test("a canonical the page set itself is kept, other meta fields stay", async () => {
    const withMeta = page({
      component: async () => ({ default: "<P>", load: async () => ({ meta: { description: "d", canonical: "/store" } }) }),
    });
    const out = await loadHomeTarget(event(), { kind: "path", path: "/store" }, deps({ "/store": withMeta }));

    expect(out.meta).toEqual({ description: "d", canonical: "/store" });

    const plain = await loadHomeTarget(event(), { kind: "path", path: "/store" }, deps({ "/store": withMeta }));
    expect(plain.meta.description).toBe("d");
  });

  test("a named view goes through the registry, an override renders instead of the default", async () => {
    registry.registerViews([
      {
        name: "market:Store",
        pluginId: "pano-plugin-market",
        contract: 1,
        kind: "page",
        component: async () => ({ default: "<DefaultStore>", load: async () => ({ products: 9 }) }),
      },
    ]);

    const out = await loadHomeTarget(event(), { kind: "path", path: "/store" }, deps({ "/store": { view: "market:Store", path: "/store" } }));
    expect(out.component.default).toBe("<DefaultStore>");
    expect(out.props).toEqual({ products: 9 });
    expect(out.viewSource).toBe("default");
  });

  test("params of the matched page reach the load", async () => {
    let seen = null;
    const withParams = {
      component: async () => ({
        default: "<P>",
        load: async (e) => {
          seen = e.params;
          return {};
        },
      }),
    };
    const ev = event();
    await loadHomeTarget(ev, { kind: "path", path: "/store/vip" }, {
      ...deps({}),
      findPage: () => ({ ...withParams, params: { slug: "vip" } }),
    });

    expect(seen).toEqual({ slug: "vip" });
  });

  test("a guest on a loginRequired page goes to login", async () => {
    let thrown = null;
    try {
      await loadHomeTarget(event(), { kind: "path", path: "/store" }, deps({ "/store": page({ loginRequired: true }) }));
    } catch (e) {
      thrown = e;
    }

    expect(thrown?.status).toBe(302);
    expect(thrown.location).toContain("/login");
  });

  test("no permission, or no page any more: null (the feed is shown)", async () => {
    expect(await loadHomeTarget(event(), { kind: "path", path: "/store" }, deps({ "/store": page({ permission: "x" }) }, { hasPermission: () => false }))).toBeNull();
    expect(await loadHomeTarget(event(), { kind: "path", path: "/store" }, deps({}))).toBeNull();
    expect(await loadHomeTarget(event(), { kind: "page", id: "landing" }, deps({}))).toBeNull();
  });

  test("a page of the theme: its own load, the data of the blocks it places, the component", async () => {
    registry.registerViews([
      {
        name: "market:Grid",
        pluginId: "pano-plugin-market",
        contract: 1,
        kind: "component",
        block: true,
        component: async () => ({ default: "<Grid>", load: async () => ({ items: 4 }) }),
      },
    ]);
    registry.setThemeMeta({
      refs: { "home:landing": [{ id: "market:Grid", props: {} }] },
      claims: [],
      homePages: { landing: async () => ({ default: "<Landing>", load: async () => ({ headline: "hi" }) }) },
    });

    const out = await loadHomeTarget(event(), { kind: "page", id: "landing" }, deps({}));

    expect(out.homeKind).toBe("page");
    expect(out.HomeComponent).toBe("<Landing>");
    expect(out.headline).toBe("hi");
    expect(out["block:market:Grid#{}"]).toEqual({ items: 4 });
  });
});

// ---------------------------------------------------------------------------
// sync: /posts
// ---------------------------------------------------------------------------

describe("sync generates /posts", () => {
  const roots = [];
  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  function makeTheme(config) {
    const dir = mkdtempSync(join(tmpdir(), "theme-core-home-"));
    roots.push(dir);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "pano-fixture-theme" }));
    writeFileSync(join(dir, "theme.config.js"), `export default ${JSON.stringify(config)};\n`);
    mkdirSync(dirname(join(dir, "src/pages/X.svelte")), { recursive: true });
    writeFileSync(join(dir, "src/pages/X.svelte"), "<h1>x</h1>\n");
    return dir;
  }

  const sync = (cwd) => {
    const proc = Bun.spawnSync([process.execPath, syncJs], { cwd, stdout: "pipe", stderr: "pipe" });
    return { code: proc.exitCode, out: proc.stdout.toString() + proc.stderr.toString() };
  };

  test("the same controller as the home page", () => {
    const dir = makeTheme({});
    expect(sync(dir).code).toBe(0);

    for (const file of ["+page.js", "+page.svelte"]) {
      const home = readFileSync(join(dir, "src/routes/(theme)", file), "utf-8");
      const posts = readFileSync(join(dir, "src/routes/(theme)/posts", file), "utf-8");
      expect(posts).toContain("$pano/lib/pages/HomePage.svelte");
      expect(posts.replaceAll("(theme)/posts", "(theme)")).toBe(home);
    }
  });

  test("a theme cannot add its own /posts", () => {
    const dir = makeTheme({ routes: { add: { "/posts": "./src/pages/X.svelte" } } });
    const result = sync(dir);

    expect(result.code).not.toBe(0);
    expect(result.out).toContain("/posts is reserved");
    expect(existsSync(join(dir, "src/routes/(theme)/posts/+page.js"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// route() in the default views and parts
// ---------------------------------------------------------------------------

describe.skipIf(!svelteDir)("default views and parts publish the renamed route", () => {
  const cases = buildCases();
  const render = (entry, props, context) => renderPart({ svelteDir, entry, props, context: context?.() });
  const hrefs = (html) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

  test("without a route config the markup keeps today's hrefs", async () => {
    const html = await render("$pano/lib/components/TicketRow.svelte", cases["TicketRow/new"].props);

    expect(hrefs(html)).toContain("/ticket/1");
    expect(hrefs(html)).toContain("/tickets?category=c1");
  });

  test("TicketRow: the ticket link and the category filter", async () => {
    routes.setRouteConfig({ routes: { rename: { "/ticket/[id]": "/help/[id]", "/tickets": "/my-tickets" } } });
    const html = await render("$pano/lib/components/TicketRow.svelte", cases["TicketRow/new"].props);

    expect(hrefs(html)).toContain("/help/1");
    expect(hrefs(html)).toContain("/my-tickets?category=c1");
    expect(hrefs(html)).not.toContain("/ticket/1");
  });

  test("a view (SupportView) renders the renamed link", async () => {
    routes.setRouteConfig({ routes: { rename: { "/ticket/create": "/help/new" } } });
    const html = await renderPart({
      svelteDir,
      entry: "$pano/lib/views/SupportView.svelte",
      props: {
        data: {},
        session: readable({ siteInfo: { supportEmail: "a@b.c" } }),
        items: readable([{ id: "support-options" }]),
        optionItems: readable([{ id: "create-ticket" }, { id: "send-email" }]),
      },
      extraSvelte: {
        "$pano/lib/components/Hook.svelte": "<script>export let name;</script>",
        "$pano/lib/components/ViewComponent.svelte": "<script>export let item;</script>",
      },
    });

    expect(hrefs(html)).toContain("/help/new");
    expect(hrefs(html)).not.toContain("/ticket/create");
  });

  test("Breadcrumb: a crumb href is mapped, its query is kept", async () => {
    routes.setRouteConfig({ routes: { rename: { "/profile": "/me" } } });
    const items = [{ label: "a", href: "/profile?tab=1" }, { label: "b", href: "https://example.com/profile" }, { label: "c", href: "/profile" }, { label: "last" }];
    const html = await renderPart({
      svelteDir,
      entry: "$pano/lib/views/parts/Breadcrumb.svelte",
      props: { items },
    });

    expect(hrefs(html)).toEqual(["/me?tab=1", "https://example.com/profile", "/me"]);
  });

  test("Post: post, player and category links; the category goes to /posts when the feed is not the home page", async () => {
    const entry = "$pano/lib/components/Post.svelte";
    const { props } = cases["Post/overlay-category"];
    const context = (siteInfo) => () =>
      new Map([
        ["themeSettings", {}],
        ["session", readable({ siteInfo })],
      ]);

    // the feed is the home page: today's link
    let html = await render(entry, props, context({ homePage: null }));
    expect(hrefs(html)).toContain("/?category=cat-3");
    expect(hrefs(html)).toContain("/post/post-3");

    // renamed post route, a plugin page is the home page
    registry.setThemeConfig(THEME);
    routes.setRouteConfig({ routes: { rename: { "/post/[url]": "/news/[url]", "/player/[player]": "/u/[player]", "/posts": "/feed" } } });
    html = await render(entry, props, context({ homePage: "store" }));
    expect(hrefs(html)).toContain("/news/post-3");
    expect(hrefs(html)).toContain("/u/writer3");
    expect(hrefs(html)).toContain("/feed?category=cat-3");
    expect(hrefs(html)).not.toContain("/?category=cat-3");
  });
});

// ---------------------------------------------------------------------------
// Notification links
// ---------------------------------------------------------------------------

describe("notification hrefs", () => {
  test("the navigate callback gets the public path; unsafe hrefs are still ignored", async () => {
    const { onNotificationClick } = await import("../NotificationManager.js");
    routes.setRouteConfig({ routes: { rename: { "/tickets": "/my-tickets", "/ticket/[id]": "/help/[id]" } } });
    const opened = [];
    const navigate = (path) => opened.push(path);

    onNotificationClick({ type: "NO_LISTENER_X", details: { href: "/ticket/5" } }, navigate);
    onNotificationClick({ type: "NO_LISTENER_X", details: { href: "/tickets?pageType=CLOSED" } }, navigate);
    onNotificationClick({ type: "NO_LISTENER_X", details: { href: "//evil.example" } }, navigate);
    onNotificationClick({ type: "NO_LISTENER_X", details: { href: "https://evil.example" } }, navigate);
    onNotificationClick({ type: "NO_LISTENER_X" }, navigate);
    onNotificationClick({ type: "NO_LISTENER_X", details: { href: "/ticket/5" } });

    expect(opened).toEqual(["/help/5", "/my-tickets?pageType=CLOSED"]);
  });
});
