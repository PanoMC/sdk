import { beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// TC-11: every engine call site resolves its view through loadView. The page and
// layout controllers are .svelte files, which bun cannot import here, so their
// `<script context="module">` is extracted, its imports are replaced by stubs and
// its view thunks by markers, and `load` is run against the real registry.

mock.module("$app/environment", () => ({ dev: false, browser: false }));
const registry = await import("../../registry/index.js");
mock.module("$pano/registry/index.js", () => registry);
// root-layout-load.js registers the generated engine table at import; the tests register their own.
mock.module("$pano/lib/views/parts/engine-views.generated.js", () => ({ engineViews: {} }));

const libDir = join(import.meta.dir, "..");

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function moduleScript(file) {
  const m = readFileSync(file, "utf8").match(/<script context="module">([\s\S]*?)<\/script>/);
  return m ? m[1] : "";
}

const pageFiles = walk(join(libDir, "pages")).filter((f) => f.endsWith(".svelte"));
const layoutFiles = ["AppLayout", "AuthLayout", "ProfileLayout", "ThemeSettingsLayout", "TicketsLayout", "MainLayout"].map(
  (n) => join(libDir, "layouts", `${n}.svelte`),
);

describe("call sites", () => {
  test("no controller awaits a bare viewPromise", () => {
    for (const file of [...pageFiles, ...layoutFiles]) {
      expect(moduleScript(file)).not.toContain("await viewPromise");
    }
  });

  test("every controller except the error page calls loadView", () => {
    for (const file of [...pageFiles, ...layoutFiles].filter((f) => !f.endsWith("ErrorPage.svelte"))) {
      expect(moduleScript(file)).toContain("loadView(");
      expect(moduleScript(file)).not.toContain("resolveView(");
    }
  });
});

/** Stubs for everything a controller imports except the registry. */
function build(file) {
  let src = moduleScript(file);
  const names = [];
  src = src.replace(/import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];?/g, (all, what, from) => {
    if (from === "$pano/registry/index.js") return 'import { loadView, resolveView } from "$pano/registry/index.js";';
    for (const part of what.replace(/[{}]/g, ",").split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name) names.push(name);
    }
    return "";
  });
  // the default view thunks become markers
  src = src.replace(/import\(\s*["']([^"']*\/([A-Za-z]+)\.svelte)["']\s*\)/g, (_, _p, base) =>
    `Promise.resolve({ default: "<${base}>" })`,
  );
  const stubs = [...new Set(names)]
    .filter((n) => n !== "loadView" && n !== "resolveView")
    .map((n) => `const ${n} = globalThis.__tc11Stub("${n}");`)
    .join("\n");
  return `${stubs}\n${src}`;
}

const stubFor = (name) => {
  const fn = async () => ({});
  if (name === "processLoad" || name.startsWith("process")) return fn;
  if (name === "error") return (status) => new Error(`error ${status}`);
  if (name === "writable") return (v) => ({ set() {}, subscribe() {}, v });
  if (name === "ApiUtil") return { get: async () => ({ registerAgreement: "x" }) };
  if (name === "panoApiServer") {
    const handler = { get: () => new Proxy(function () {}, handler), apply: () => undefined };
    return new Proxy(function () {}, handler);
  }
  return fn;
};
globalThis.__tc11Stub = stubFor;

const event = () => ({
  parent: async () => ({
    session: { siteInfo: { hasRegisterAgreement: true }, csrfToken: "t" },
    themeSettings: {},
  }),
  url: new URL("http://localhost/"),
  params: {},
});

const tmpRoot = mkdtempSync(join(tmpdir(), "tc11-"));

async function loadFor(file) {
  const out = join(tmpRoot, file.split("/").slice(-2).join("_").replace(".svelte", ".mjs"));
  writeFileSync(out, build(file));
  const mod = await import(out + "?v=" + Math.random());
  return mod.load(event());
}

beforeEach(() => {
  registry.resetRegistryForTests();
  registry.setThemeConfig({});
});

const expectedKey = (file) => {
  const alias = readFileSync(file, "utf8").match(/(\w*[Ll]ayoutView): View/);
  return alias ? alias[1] : "View";
};

describe("controllers return their view through loadView", () => {
  for (const file of [...pageFiles, ...layoutFiles].filter((f) => !f.endsWith("ErrorPage.svelte"))) {
    const label = file.slice(libDir.length + 1);
    test(label, async () => {
      const data = await loadFor(file);
      const key = expectedKey(file);
      expect(typeof data[key]).toBe("string");
      expect(data[key]).toMatch(/^<[A-Za-z]+View>$/);
    });
  }

  test("a theme override replaces the markup and a block's data is merged", async () => {
    registry.registerEngineViews({
      HomeView: { contract: 1, component: async () => ({ default: "<HomeView>" }), uses: ["market:NavCart"] },
    });
    registry.registerViews([
      {
        name: "market:NavCart",
        pluginId: "pano-plugin-market",
        contract: 1,
        kind: "component",
        block: true,
        component: async () => ({ default: "<NavCart>", load: async () => ({ items: 3 }) }),
      },
    ]);
    registry.setThemeConfig({ views: { HomeView: async () => "<ThemeHome>" } });
    registry.setThemeMeta({ refs: { HomeView: [{ id: "market:NavCart", props: {} }] }, claims: [], homePages: {} });
    const data = await loadFor(join(libDir, "pages/HomePage.svelte"));
    expect(data.View).toBe("<ThemeHome>");
    expect(data["block:market:NavCart#{}"]).toEqual({ items: 3 });
  });
});

describe("loadChrome", () => {
  test("no override: nothing is loaded and nothing is returned", async () => {
    mock.module("$pano/lib/layouts/AppLayout.svelte", () => ({ load: async () => ({ app: 1 }) }));
    mock.module("$pano/lib/layouts/MainLayout.svelte", () => ({ load: async () => ({ main: 1 }) }));
    const { loadChrome, load } = await import("../../routes/root-layout-load.js");
    expect(await loadChrome(event())).toEqual({});
    expect(await load(event())).toEqual({ app: 1, main: 1 });
  });

  test("an overridden chrome part is preloaded and its block data is returned without a View key", async () => {
    registry.registerEngineViews({
      Sidebar: { contract: 1, component: async () => ({ default: "<Sidebar>" }) },
    });
    registry.registerViews([
      {
        name: "market:SideCart",
        pluginId: "pano-plugin-market",
        contract: 1,
        kind: "component",
        block: true,
        component: async () => ({ default: "<SideCart>", load: async () => ({ items: 2 }) }),
      },
    ]);
    registry.setThemeConfig({ views: { Sidebar: async () => ({ default: "<ThemeSidebar>" }) } });
    registry.setThemeMeta({
      refs: { Sidebar: [{ id: "market:SideCart", props: {} }] },
      claims: [],
      homePages: {},
    });
    const { loadChrome } = await import("../../routes/root-layout-load.js");
    const out = await loadChrome(event());
    expect(out.View).toBeUndefined();
    expect(out["block:market:SideCart#{}"]).toEqual({ items: 2 });
    expect(registry.getOverride("Sidebar")).toBe("<ThemeSidebar>");
  });
});
