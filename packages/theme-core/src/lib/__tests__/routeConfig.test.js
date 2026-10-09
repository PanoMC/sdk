import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { findSvelte } from "./svelteSsr.helper.js";

// Route config in the engine (TC-12, doc 01 section 9): what `theme-core sync` generates for
// routes.add / hooks.js, the 308 for a renamed-away path, the 404 for a disabled one, and
// themePageLoad.

mock.module("$app/environment", () => ({ dev: false, browser: false }));
mock.module("$pano/lib/api.util", () => ({ default: {} }));

// Modules the plugin-ui Layout imports.
mock.module("@sveltejs/kit", () => ({
  error: (status) => Object.assign(new Error(`HTTP ${status}`), { status }),
  redirect: (status, location) => Object.assign(new Error("redirect"), { status, location }),
}));
mock.module("$app/paths", () => ({ base: "" }));
mock.module("$pano/lib/PluginManager.js", () => ({
  registeredPages: { "/store": { name: "store" }, "/store/vip": { name: "vip" }, "/rules": { name: "rules-plugin" } },
  findMatch: (pages, path) => pages[path] ?? null,
}));
mock.module("$pano/lib/auth.util.js", () => ({ hasPermission: () => true }));
mock.module("$pano/lib/returnTo.util.js", () => ({ loginRedirectFor: () => null }));
mock.module("$pano/registry/routes.js", () => routes);
for (const name of ["App", "Auth", "Main", "Profile", "ThemeSettings", "Tickets"]) {
  mock.module(`$pano/lib/layouts/${name}Layout.svelte`, () => ({ default: null }));
}



const pkgDir = join(import.meta.dir, "..", "..", "..");
const syncJs = join(pkgDir, "bin", "sync.js");

const routes = await import("../../registry/routes.js");
const { redirectRenamedPath, createThemeHooks } = await import("../../kit/hooks-server.js");
const registry = await import("../../registry/index.js");
const { themePageLoad } = await import("../themePageLoad.js");

const roots = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// sync.js on a fixture theme
// ---------------------------------------------------------------------------

function makeTheme(config, { files = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "theme-core-routes-"));
  roots.push(dir);

  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "pano-fixture-theme" }));
  writeFileSync(join(dir, "theme.config.js"), `export default ${JSON.stringify(config)};\n`);

  for (const [path, content] of Object.entries({
    "src/pages/StaffTeam.svelte": "<h1>Staff</h1>\n",
    "src/pages/Member.svelte": "<h1>Member</h1>\n",
    ...files,
  })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }

  return dir;
}

function sync(cwd) {
  const proc = Bun.spawnSync([process.execPath, syncJs], { cwd, stdout: "pipe", stderr: "pipe" });

  return { code: proc.exitCode, out: proc.stdout.toString() + proc.stderr.toString() };
}

const read = (dir, path) => readFileSync(join(dir, path), "utf-8");

describe("sync: routes.add and hooks.js", () => {
  const config = {
    routes: {
      add: { "/staff-team": "./src/pages/StaffTeam.svelte", "/team/[slug]": "./src/pages/Member.svelte" },
      rename: { "/store": "/shop" },
      disable: ["/rules"],
    },
  };

  test("generates src/hooks.js, a page pair per added route and the plugin UI file route", () => {
    const dir = makeTheme(config);
    const result = sync(dir);
    expect(result.code).toBe(0);

    const hooks = read(dir, "src/hooks.js");
    expect(hooks).toContain('import themeConfig from "../theme.config.js";');
    expect(hooks).toContain("export const reroute = createReroute(themeConfig);");
    expect(hooks).toContain("setRouteConfig(themeConfig);");

    const pageJs = read(dir, "src/routes/(theme)/staff-team/+page.js");
    expect(pageJs).toContain('import * as mod from "../../../pages/StaffTeam.svelte";');
    expect(pageJs).toContain('import { themePageLoad } from "$pano/lib/themePageLoad.js";');
    expect(pageJs).toContain('export const load = themePageLoad("route:/staff-team", mod);');

    const pageSvelte = read(dir, "src/routes/(theme)/staff-team/+page.svelte");
    expect(pageSvelte).toContain('import ThemePage from "../../../pages/StaffTeam.svelte";');
    expect(pageSvelte).toContain("<ThemePage {data} />");

    expect(read(dir, "src/routes/(theme)/team/[slug]/+page.js")).toContain(
      'themePageLoad("route:/team/[slug]", mod)',
    );
    expect(read(dir, "src/routes/(theme)/team/[slug]/+page.js")).toContain('"../../../../pages/Member.svelte"');

    expect(read(dir, "src/routes/(theme)/plugins/[pluginId]/resources/plugin-ui/[kind]/[...file]/+server.js")).toContain(
      'export { GET } from "$pano/routes/plugins-ui-file.js";',
    );
    // the existing client file route stays
    expect(existsSync(join(dir, "src/routes/(theme)/plugins/[pluginId]/resources/plugin-ui/client/[fileName]/+server.js"))).toBe(true);
  });

  test("a second run is stable and dropping an entry removes its generated files", () => {
    const dir = makeTheme(config);
    expect(sync(dir).code).toBe(0);

    const before = read(dir, "src/routes/(theme)/staff-team/+page.js");
    expect(sync(dir).code).toBe(0);
    expect(read(dir, "src/routes/(theme)/staff-team/+page.js")).toBe(before);

    writeFileSync(join(dir, "theme.config.js"), `export default { routes: { add: { "/team/[slug]": "./src/pages/Member.svelte" } } };\n`);
    expect(sync(dir).code).toBe(0);
    expect(existsSync(join(dir, "src/routes/(theme)/staff-team"))).toBe(false);
    expect(existsSync(join(dir, "src/routes/(theme)/team/[slug]/+page.js"))).toBe(true);
  });

  test("a theme without routes gets hooks.js and no extra route", () => {
    const dir = makeTheme({});
    expect(sync(dir).code).toBe(0);
    expect(read(dir, "src/hooks.js")).toContain("createReroute(themeConfig)");
    expect(existsSync(join(dir, "src/routes/(theme)/staff-team"))).toBe(false);
  });

  test("a hand-written hooks.js is left alone", () => {
    const dir = makeTheme({}, { files: { "src/hooks.js": "export const reroute = () => {};\n" } });
    const result = sync(dir);
    expect(result.code).toBe(0);
    expect(result.out).toContain("hand-written");
    expect(read(dir, "src/hooks.js")).toBe("export const reroute = () => {};\n");
  });

  describe("add is an error when it cannot be a new route", () => {
    for (const [label, add, message] of [
      ["a live canonical path", { "/rules": "./src/pages/StaffTeam.svelte" }, /already serves/],
      ["a live path with other param names", { "/post/[slug]": "./src/pages/StaffTeam.svelte" }, /already serves/],
      ["the home path", { "/": "./src/pages/StaffTeam.svelte" }, /already serves/],
      ["/posts", { "/posts": "./src/pages/StaffTeam.svelte" }, /reserved/],
      ["/__pano*", { "/__pano-x": "./src/pages/StaffTeam.svelte" }, /reserved/],
      ["a missing file", { "/staff": "./src/pages/Nope.svelte" }, /does not exist/],
      ["an invalid pattern", { "/a/[x]/[x]": "./src/pages/StaffTeam.svelte" }, /twice/],
    ]) {
      test(label, () => {
        const dir = makeTheme({ routes: { add } });
        const result = sync(dir);
        expect(result.code).toBe(1);
        expect(result.out).toMatch(message);
        // nothing was written
        expect(existsSync(join(dir, "src/routes"))).toBe(false);
        expect(existsSync(join(dir, "src/hooks.js"))).toBe(false);
      });
    }

    test("a path already published by a rename", () => {
      const dir = makeTheme({
        routes: { rename: { "/store": "/shop" }, add: { "/shop": "./src/pages/StaffTeam.svelte" } },
      });
      const result = sync(dir);
      expect(result.code).toBe(1);
      expect(result.out).toMatch(/renamed route/);
    });

    test("an invalid rename", () => {
      const dir = makeTheme({ routes: { rename: { "/store/[slug]": "/shop/[id]" } } });
      const result = sync(dir);
      expect(result.code).toBe(1);
      expect(result.out).toMatch(/same params/);
    });
  });
});

// ---------------------------------------------------------------------------
// 308 for a renamed-away canonical path
// ---------------------------------------------------------------------------

const themeConfig = {
  routes: {
    rename: { "/store": "/shop", "/store/[slug]": "/shop/[slug]" },
    disable: ["/rules"],
  },
};

const get = (path, extra = {}) => ({
  url: new URL(path, "http://localhost"),
  request: { method: "GET" },
  ...extra,
});

describe("hooks-server: renamed-away path", () => {
  beforeEach(() => routes.setRouteConfig(themeConfig));

  test("the canonical path answers 308 to the public path, query kept", () => {
    const response = redirectRenamedPath(get("/store/vip?ref=1"));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("/shop/vip?ref=1");

    expect(redirectRenamedPath(get("/store")).headers.get("location")).toBe("/shop");
  });

  test("the public path, other paths and a theme without renames pass", () => {
    expect(redirectRenamedPath(get("/shop"))).toBeNull();
    expect(redirectRenamedPath(get("/shop/vip"))).toBeNull();
    expect(redirectRenamedPath(get("/profile"))).toBeNull();
    routes.setRouteConfig({});
    expect(redirectRenamedPath(get("/store"))).toBeNull();
  });

  test("data requests and non-GET methods keep resolving the canonical path", () => {
    expect(redirectRenamedPath(get("/store", { isDataRequest: true }))).toBeNull();
    expect(redirectRenamedPath(get("/store", { request: { method: "POST" } }))).toBeNull();
    expect(redirectRenamedPath(get("/store", { request: { method: "HEAD" } })).status).toBe(308);
  });

  test("a swap redirects nothing, a base is kept", () => {
    routes.setRouteConfig({ routes: { rename: { "/a": "/b", "/b": "/a" } } });
    expect(redirectRenamedPath(get("/a"))).toBeNull();
    expect(redirectRenamedPath(get("/b"))).toBeNull();

    routes.setRouteConfig(themeConfig);
    expect(redirectRenamedPath(get("/base/store"), "/base").headers.get("location")).toBe("/base/shop");
  });

  test("handle() answers the 308 before it resolves anything", async () => {
    const { handle } = createThemeHooks({ internalLibsHash: "h", runtimeShimsHash: "s" });
    let resolved = false;

    const response = await handle({
      event: { ...get("/store/vip"), cookies: { get: () => undefined }, locals: {} },
      resolve: async () => {
        resolved = true;
        return new Response("page");
      },
    });

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("/shop/vip");
    expect(resolved).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// disabled -> 404 in the plugin-ui catch-all (Layout.svelte load)
// ---------------------------------------------------------------------------

const svelteDir = findSvelte();

describe.skipIf(!svelteDir)("plugin-ui Layout load", () => {
  /** @type {(event: any) => Promise<any>} */
  let load;

  beforeEach(async () => {
    if (load) return;

    const compiler = await import(join(svelteDir, "src", "compiler", "index.js"));
    // Inside the package so `svelte` resolves from the package's own node_modules.
    const dir = mkdtempSync(join(import.meta.dir, ".tmp-routeconfig-"));
    roots.push(dir);

    const source = readFileSync(join(pkgDir, "src", "routes", "plugin-ui", "Layout.svelte"), "utf-8");
    const { js } = compiler.compile(source, { generate: "server", filename: "Layout.svelte" });
    writeFileSync(join(dir, "Layout.mjs"), js.code);

    load = (await import(join(dir, "Layout.mjs"))).load;
  });

  const event = (pathname) => ({
    url: { pathname, search: "" },
    parent: async () => ({ session: { user: null } }),
    params: {},
  });

  const status = async (pathname) => {
    try {
      await load(event(pathname));
      return 200;
    } catch (e) {
      return e.status;
    }
  };

  test("a public path is turned into the canonical one before findMatch", async () => {
    routes.setRouteConfig(themeConfig);

    const output = await load(event("/shop/vip"));
    expect(output.registeredPage.name).toBe("vip");
    expect((await load(event("/shop"))).registeredPage.name).toBe("store");
  });

  test("a disabled route is a 404 even when a plugin registered it", async () => {
    routes.setRouteConfig(themeConfig);

    expect(await status("/rules")).toBe(404);
    routes.setRouteConfig({});
    expect(await status("/rules")).toBe(200);
  });

  test("/__pano* is never served by a plugin page, unknown paths are 404", async () => {
    routes.setRouteConfig(themeConfig);

    expect(await status("/__pano-disabled")).toBe(404);
    expect(await status("/__pano/views")).toBe(404);
    expect(await status("/nothing-here")).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// themePageLoad
// ---------------------------------------------------------------------------

describe("themePageLoad", () => {
  beforeEach(() => registry.resetRegistryForTests());

  test("the page's own load output, plus the loads of the blocks its closure places", async () => {
    registry.registerViews([
      {
        name: "market:NavCart",
        pluginId: "pano-plugin-market",
        contract: 1,
        block: true,
        component: async () => ({ default: function () {}, load: async (_event, props) => ({ cart: props?.size ?? 0 }) }),
      },
    ]);
    registry.setThemeConfig({ views: {} });
    registry.setThemeMeta({
      refs: { "route:/staff-team": [{ id: "market:NavCart", props: { size: 3 } }] },
      claims: [],
      homePages: {},
    });

    const pageModule = { load: async (event) => ({ title: "Staff", seen: event.params.x }) };
    const load = themePageLoad("route:/staff-team", pageModule);
    const data = await load({ params: { x: "1" } });

    expect(data.title).toBe("Staff");
    expect(data.seen).toBe("1");
    const blockKeys = Object.keys(data).filter((key) => key.startsWith("block:"));
    expect(blockKeys).toHaveLength(1);
    expect(data[blockKeys[0]]).toEqual({ cart: 3 });
  });

  test("a page without a load, a thunk module and a failing closure", async () => {
    registry.setThemeConfig({ views: {} });

    expect(await themePageLoad("route:/plain", { default: function () {} })({ params: {} })).toEqual({});
    expect(await themePageLoad("route:/lazy", async () => ({ load: async () => ({ a: 1 }) }))({ params: {} })).toEqual({ a: 1 });
    expect(await themePageLoad("route:/null", { load: async () => null })({ params: {} })).toEqual({});
  });
});
