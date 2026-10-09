import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Window } from "happy-dom";
import { writable } from "svelte/store";

import { findSvelte } from "./svelteSsr.helper.js";

// TC-53: the engine side of the scoped fallback stylesheet (doc 03 sections 4.1, 4.4, 4.5, 4.6 and slice 6).
//
// Part 1 is plain unit tests (the store, the hrefs, the style table, the seven steps of `wrap`, the cache header).
// Part 2 compiles the real engine files (RootLayout, Page, PluginBlock, PluginSlot, FallbackScope) with the Svelte
// compiler and renders a fixture plugin (`tst`) in a theme without Bootstrap, on the server and in the browser
// (happy-dom). Only the SvelteKit aliases, the two layouts and the plugin API are stubs.

// ---------------------------------------------------------------------------
// Stubs of the SvelteKit aliases (bun mocks are process-wide: every stub is a superset of what other suites use)
// ---------------------------------------------------------------------------

class Redirect {
  constructor(status, location) {
    this.status = status;
    this.location = location;
  }
}

const pageState = { current: { data: {}, url: new URL("http://localhost/"), params: {}, route: { id: "/" }, error: null } };
const pageStore = {
  subscribe(run) {
    run(pageState.current);
    return () => {};
  },
};

mock.module("@sveltejs/kit", () => ({
  redirect: (status, location) => {
    throw new Redirect(status, location);
  },
  error: (status, message) => Object.assign(new Error(`HTTP ${status} ${message ?? ""}`), { status }),
}));
mock.module("$app/paths", () => ({ base: "" }));
mock.module("$app/environment", () => ({ browser: false, dev: false }));
mock.module("$app/navigation", () => ({
  goto: async () => {},
  invalidate: async () => {},
  invalidateAll: async () => {},
}));
mock.module("$app/stores", () => ({ page: pageStore, navigating: writable(null) }));

const registry = await import("../../registry/index.js");
const { createViewProxy } = await import("../../../../sdk/src/views.js");
const { setPanoContext, getPanoContext } = await import("../../../../sdk/src/internal/index.js");
const fallbackStylesFile = join(import.meta.dir, "..", "fallbackStyles.js");
const fallback = await import("../fallbackStyles.js");
const { cacheHeadersFor, GET: clientFileGET } = await import("../../routes/plugins-client-file.js");

const {
  buildStyleTable,
  createFallbackStyles,
  createViewWrapper,
  fallbackHref,
  SCOPE_CONTEXT,
  STYLES_CONTEXT,
  setActiveFallbackStyles,
} = fallback;

const HASH = "9f2c1a7e";

/** What the server load hands the browser: the styles of the fixture plugin `tst`. */
const TABLE = {
  tst: {
    id: "pano-plugin-tst",
    ns: "tst",
    styles: { fallback: "client/fallback.css", own: "client/plugin.css", hash: HASH, icons: true },
    roots: { Home: ["section"], Row: ["tr"], Table: ["table"], Badge: ["span"] },
  },
};

// ---------------------------------------------------------------------------
// 1. The pure parts
// ---------------------------------------------------------------------------

describe("createFallbackStyles", () => {
  test("server: a plain Set, add is synchronous, an existing key is not added twice", () => {
    const styles = createFallbackStyles({ browser: false });

    styles.add("tst");
    styles.add("tst");
    styles.add("own:tst");

    expect([...styles.keys]).toEqual(["tst", "own:tst"]);
  });

  test("client: add is deferred with queueMicrotask, and keys are never removed", async () => {
    const styles = createFallbackStyles({ browser: true });

    styles.add("tst");
    expect(styles.keys.has("tst")).toBe(false);

    await Promise.resolve();
    expect(styles.keys.has("tst")).toBe(true);

    // the store only adds: there is no remove on it
    expect(Object.keys(styles).sort()).toEqual(["add", "keys"]);
  });

  test("client: starts with the links the server rendered in <head>", () => {
    const dom = new Window();
    const had = Object.getOwnPropertyDescriptor(globalThis, "document");

    dom.document.head.innerHTML =
      '<link rel="stylesheet" href="/a.css" data-pano-fb-style="tst"><link rel="stylesheet" href="/b.css"><link rel="stylesheet" href="/c.css" data-pano-fb-style="icons">';
    Object.defineProperty(globalThis, "document", { value: dom.document, configurable: true, writable: true });

    try {
      expect([...createFallbackStyles({ browser: true }).keys]).toEqual(["tst", "icons"]);
    } finally {
      if (had) Object.defineProperty(globalThis, "document", had);
      else delete globalThis.document;
    }
  });
});

describe("fallbackHref", () => {
  test("a plugin's fallback sheet, its own sheet, the engine sheet and the icon sheet", () => {
    expect(fallbackHref("tst", TABLE)).toBe(`/plugins/pano-plugin-tst/resources/plugin-ui/client/fallback.css?v=${HASH}`);
    expect(fallbackHref("own:tst", TABLE)).toBe(`/plugins/pano-plugin-tst/resources/plugin-ui/client/plugin.css?v=${HASH}`);
    expect(fallbackHref("pano", TABLE)).toBe("/assets/css/pano-fallback.css");
    expect(fallbackHref("icons", TABLE)).toBe("/assets/css/pano-fallback-icons.css");
    expect(fallbackHref("legacy", TABLE)).toBe("/assets/css/pano-fallback-legacy.css");
    expect(fallbackHref("legacy", {})).toBe("/assets/css/pano-fallback-legacy.css");
  });

  test("the base path is prepended to every kind", () => {
    expect(fallbackHref("tst", TABLE, "/site")).toStartWith("/site/plugins/pano-plugin-tst/");
    expect(fallbackHref("pano", TABLE, "/site")).toBe("/site/assets/css/pano-fallback.css");
    expect(fallbackHref("icons", TABLE, "/site")).toBe("/site/assets/css/pano-fallback-icons.css");
    expect(fallbackHref("legacy", TABLE, "/site")).toBe("/site/assets/css/pano-fallback-legacy.css");
  });

  test("a plugin id is accepted for the namespace; unknown keys and missing files give null; no hash, no query", () => {
    expect(fallbackHref("pano-plugin-tst", TABLE)).toContain("/client/fallback.css?v=");
    expect(fallbackHref("nope", TABLE)).toBeNull();
    expect(fallbackHref("own:nope", TABLE)).toBeNull();
    expect(fallbackHref("own:tst", { tst: { id: "x", ns: "tst", styles: { fallback: "client/fallback.css" } } })).toBeNull();
    expect(fallbackHref("tst", { tst: { id: "x", ns: "tst", styles: { fallback: "client/fallback.css" } } })).toBe(
      "/plugins/x/resources/plugin-ui/client/fallback.css",
    );
    expect(fallbackHref("tst", null)).toBeNull();
  });
});

describe("buildStyleTable", () => {
  test("keeps the styles and the view roots of plugins with a namespace, nothing else", () => {
    const table = buildStyleTable([
      {
        id: "pano-plugin-tst",
        namespace: "tst",
        styles: { fallback: "client/fallback.css", own: "client/plugin.css", hash: HASH, icons: true, junk: 1 },
        views: { Row: { roots: ["tr"], classes: ["a", "b"] }, Home: { roots: ["section", 3] }, Odd: {} },
      },
      { id: "legacy", styles: { fallback: "x" } },
      null,
      { id: "plain", namespace: "plain" },
    ]);

    expect(Object.keys(table)).toEqual(["tst", "plain"]);
    expect(table.tst).toEqual({
      id: "pano-plugin-tst",
      ns: "tst",
      styles: { fallback: "client/fallback.css", own: "client/plugin.css", hash: HASH, icons: true },
      roots: { Row: ["tr"], Home: ["section"] },
    });
    expect(table.plain).toEqual({ id: "plain", ns: "plain" });
  });
});

describe("wrap: the seven steps of doc 03 section 4.4", () => {
  const FakeScope = (_anchor, payload) => ({ scope: payload });
  const Component = () => {};

  /** A wrapper with a fixed scope and a fresh store. */
  function setup({ provides = { bootstrap: false, fontawesome: true }, inside, table = TABLE, dev = false, warn } = {}) {
    const store = createFallbackStyles({ browser: false });
    const context = { [STYLES_CONTEXT]: store, [SCOPE_CONTEXT]: inside };
    const wrapper = createViewWrapper({
      FallbackScope: FakeScope,
      getTable: () => table,
      getProvides: () => provides,
      readScope: (key) => context[key],
      dev,
      warn,
    });

    return { ...wrapper, store, context };
  }

  test("1: a plugin with styles.own always gets its own sheet, in a Bootstrap theme too", () => {
    const { wrap, store } = setup({ provides: { bootstrap: true, fontawesome: true } });

    expect(wrap("tst:Home", Component, "default")).toBe(Component);
    expect([...store.keys]).toEqual(["own:tst"]);

    const override = setup({ provides: { bootstrap: true, fontawesome: true } });

    expect(override.wrap("tst:Home", Component, "override")).toBe(Component);
    expect([...override.store.keys]).toEqual(["own:tst"]);
  });

  test("2: the icon sheet only for a default view of a plugin that uses icons, when the theme has no Font Awesome", () => {
    const noIcons = setup({ provides: { bootstrap: true, fontawesome: false } });

    noIcons.wrap("tst:Home", Component, "default");
    expect([...noIcons.store.keys]).toEqual(["own:tst", "icons"]);

    // an override renders the theme's own markup: no icon sheet
    const override = setup({ provides: { bootstrap: true, fontawesome: false } });

    override.wrap("tst:Home", Component, "override");
    expect([...override.store.keys]).toEqual(["own:tst"]);

    // Font Awesome provided
    const provided = setup({ provides: { bootstrap: true, fontawesome: true } });

    provided.wrap("tst:Home", Component, "default");
    expect([...provided.store.keys]).toEqual(["own:tst"]);

    // a plugin that does not use icons
    const plain = setup({
      provides: { bootstrap: true, fontawesome: false },
      table: { tst: { ...TABLE.tst, styles: { fallback: "client/fallback.css", hash: HASH } } },
    });

    plain.wrap("tst:Home", Component, "default");
    expect([...plain.store.keys]).toEqual([]);
  });

  test("3: Bootstrap provided, no fallback file, or a table-row root: the component itself", () => {
    expect(setup({ provides: { bootstrap: true, fontawesome: true } }).wrap("tst:Home", Component, "default")).toBe(Component);

    const noFallback = setup({ table: { tst: { id: "x", ns: "tst", styles: { own: "client/plugin.css" } } } });

    expect(noFallback.wrap("tst:Home", Component, "default")).toBe(Component);
    expect([...noFallback.store.keys]).toEqual(["own:tst"]);

    for (const root of ["tr", "td", "th", "tbody", "thead", "tfoot", "col", "colgroup", "caption"]) {
      const table = { tst: { ...TABLE.tst, roots: { Row: [root] } } };
      const { wrap, store } = setup({ table });

      expect(wrap("tst:Row", Component, "default")).toBe(Component);
      expect([...store.keys].includes("tst")).toBe(false);
    }
  });

  test("4: a default view inside its own plugin's scope renders unwrapped", () => {
    const { wrap, store } = setup({ inside: "tst" });

    expect(wrap("tst:Child", Component, "default")).toBe(Component);
    expect([...store.keys].includes("tst")).toBe(false);
  });

  test("5: a default view elsewhere opens a fallback scope and asks for the plugin's sheet", () => {
    for (const inside of [undefined, null, "other"]) {
      const { wrap, store } = setup({ inside });
      const wrapped = wrap("tst:Home", Component, "default");

      expect(wrapped).not.toBe(Component);
      expect(wrapped.scope).toEqual({ mode: "fallback", ns: "tst" });
      expect([...store.keys]).toEqual(["own:tst", "tst"]);

      // the wrapper hands FallbackScope the component, the ns, the mode and the props
      const props = { a: 1 };
      const out = wrapped("anchor", props);

      expect(out.scope).toEqual({ Component, ns: "tst", mode: "fallback", props });
    }
  });

  test("6: an override inside a scope gets a stop scope", () => {
    for (const inside of ["tst", "other"]) {
      const { wrap, store } = setup({ inside });
      const wrapped = wrap("tst:Child", Component, "override");

      expect(wrapped.scope).toEqual({ mode: "stop", ns: "tst" });
      expect(wrapped("anchor", {}).scope.mode).toBe("stop");
      // a stop scope asks for no sheet
      expect([...store.keys].includes("tst")).toBe(false);
    }
  });

  test("7: an override outside every scope: the component itself", () => {
    for (const inside of [undefined, null]) {
      expect(setup({ inside }).wrap("tst:Child", Component, "override")).toBe(Component);
    }
  });

  test("a name without a colon is the engine's (ns pano) with the engine sheet; an unknown plugin is left alone", () => {
    const engine = setup();
    const wrapped = engine.wrap("Navbar", Component, "default");

    expect(wrapped.scope).toEqual({ mode: "fallback", ns: "pano" });
    expect([...engine.store.keys]).toEqual(["pano"]);

    expect(setup().wrap("ghost:Thing", Component, "default")).toBe(Component);
  });

  test("a view named by the plugin id (the alias of <ns>:<Name>) resolves to the same plugin and the same scope", () => {
    const { wrap } = setup();

    expect(wrap("pano-plugin-tst:Home", Component, "default").scope).toEqual({ mode: "fallback", ns: "tst" });
  });

  test("outside any render (getContext throws) wrap does not throw and treats it as outside every scope", () => {
    const wrapper = createViewWrapper({
      FallbackScope: FakeScope,
      getTable: () => TABLE,
      getProvides: () => ({ bootstrap: false, fontawesome: true }),
      // the default readScope is Svelte's getContext, which throws without a component
    });

    expect(() => wrapper.wrap("tst:Home", Component, "default")).not.toThrow();
    expect(wrapper.wrap("tst:Home", Component, "default").scope.mode).toBe("fallback");
  });

  test("dev mode: a plugin without styles is logged once, only in a theme without Bootstrap", () => {
    const warn = mock(() => {});
    const table = { tst: { id: "pano-plugin-tst", ns: "tst" } };
    const { wrap } = setup({ table, dev: true, warn });

    wrap("tst:Home", Component, "default");
    wrap("tst:Child", Component, "default");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("pano-plugin-tst has no fallback styles");

    const quiet = mock(() => {});

    setup({ table, dev: true, warn: quiet, provides: { bootstrap: true, fontawesome: true } }).wrap("tst:Home", Component, "default");
    setup({ table, dev: false, warn: quiet }).wrap("tst:Home", Component, "default");
    expect(quiet).not.toHaveBeenCalled();
  });

  test("without any store (a render outside RootLayout) wrap still answers", () => {
    setActiveFallbackStyles(null);

    const wrapper = createViewWrapper({
      FallbackScope: FakeScope,
      getTable: () => TABLE,
      getProvides: () => ({ bootstrap: false, fontawesome: true }),
      readScope: () => undefined,
    });

    expect(wrapper.wrap("tst:Home", Component, "default").scope.mode).toBe("fallback");
  });
});

describe("plugin client files: cache headers", () => {
  const data = Buffer.from("a{}");

  test("a versioned .css is immutable, an unversioned one is revalidated", () => {
    expect(cacheHeadersFor("fallback.css", data, true)).toEqual({ "Cache-Control": "public, max-age=31536000, immutable" });
    expect(cacheHeadersFor("plugin.css", data, true)).toEqual({ "Cache-Control": "public, max-age=31536000, immutable" });
    expect(cacheHeadersFor("fallback.css", data, false)).toEqual({ "Cache-Control": "no-cache" });
    expect(cacheHeadersFor("fallback.css", data)).toEqual({ "Cache-Control": "no-cache" });
  });

  test("the version only counts for a .css; client.mjs and the hashed chunks behave as before", () => {
    expect(cacheHeadersFor("data.json", data, true)).toEqual({ "Cache-Control": "no-cache" });
    expect(cacheHeadersFor("client.mjs", data, true)["Cache-Control"]).toBe("no-cache");
    expect(cacheHeadersFor("client.mjs", data, true).ETag).toMatch(/^"[0-9a-f]{40}"$/);
    expect(cacheHeadersFor("Chunk-a1b2c3d4e5.js", data)).toEqual({ "Cache-Control": "public, max-age=31536000, immutable" });
  });

  test("GET reads ?v= from the URL", async () => {
    const cwd = process.cwd();
    const root = mkdtempSync(join(tmpdir(), "tc53-client-"));

    mkdirSync(join(root, "plugins", "pano-plugin-tst", "client"), { recursive: true });
    writeFileSync(join(root, "plugins", "pano-plugin-tst", "client", "fallback.css"), ".pano-fb{}");

    process.chdir(root);

    try {
      const params = { pluginId: "pano-plugin-tst", fileName: "fallback.css" };
      const request = new Request("http://localhost/x");
      const versioned = await clientFileGET({ params, request, url: new URL(`http://localhost/x?v=${HASH}`) });
      const plain = await clientFileGET({ params, request, url: new URL("http://localhost/x") });

      expect(versioned.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
      expect(versioned.headers.get("Content-Type")).toContain("text/css");
      expect(plain.headers.get("Cache-Control")).toBe("no-cache");
    } finally {
      process.chdir(cwd);
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 2. The engine files, compiled
// ---------------------------------------------------------------------------

const svelteDir = findSvelte();
const pkgSrc = join(import.meta.dir, "..", "..");
const hasSvelte = svelteDir !== null;
const suite = hasSvelte ? describe : describe.skip;

const FIXTURES = {
  "Badge.svelte": `<span class="badge">{text}</span>
<script>
  let { text = "" } = $props();
</script>`,

  "Child.svelte": `<div class="child-default"><Badge text="in-child" /></div>
<script module>
  import { createViewProxy } from "@panomc/sdk/views";
  import BadgeDefault from "./Badge.svelte";

  const Badge = createViewProxy("tst:Badge", BadgeDefault);
</script>`,

  "ChildOverride.svelte": `<div class="child-override"><Badge text="in-override" /></div>
<script module>
  import { createViewProxy } from "@panomc/sdk/views";
  import BadgeDefault from "./Badge.svelte";

  const Badge = createViewProxy("tst:Badge", BadgeDefault);
</script>`,

  "Home.svelte": `<section class="home"><Child /><Badge text="page-badge" /></section>
<script module>
  import { createViewProxy } from "@panomc/sdk/views";
  import ChildDefault from "./Child.svelte";
  import BadgeDefault from "./Badge.svelte";

  const Child = createViewProxy("tst:Child", ChildDefault);
  const Badge = createViewProxy("tst:Badge", BadgeDefault);
</script>`,

  "Row.svelte": `<tr class="row"><td>cell</td></tr>`,

  "Table.svelte": `<table class="tbl"><tbody><Row /></tbody></table>
<script module>
  import { createViewProxy } from "@panomc/sdk/views";
  import RowDefault from "./Row.svelte";

  const Row = createViewProxy("tst:Row", RowDefault);
</script>`,

  "Grid.svelte": `<ul class="grid"><li>1</li></ul>`,

  "GridOverride.svelte": `<ol class="grid-override"><li>1</li></ol>`,

  "Promo.svelte": `<span class="promo">promo</span>`,

  "PromoOverride.svelte": `<b class="promo-override">promo</b>`,

  // a view that places a block and a slot itself, inside its own scope
  "Shop.svelte": `<div class="shop"><PluginBlock id="tst:Grid" /><PluginSlot id="tst:slot" /></div>
<script>
  import PluginBlock from "$pano/lib/components/PluginBlock.svelte";
  import PluginSlot from "$pano/lib/components/PluginSlot.svelte";
</script>`,

  "BlockHost.svelte": `<PluginBlock id="tst:Grid" />
<script>
  import PluginBlock from "$pano/lib/components/PluginBlock.svelte";
</script>`,

  "SlotHost.svelte": `<PluginSlot id="tst:slot" />
<script>
  import PluginSlot from "$pano/lib/components/PluginSlot.svelte";
</script>`,

  // the root layout around a view; the client variant can drop the view again
  "App.svelte": `<RootLayout {data}>{#if show}<View {...props} />{/if}</RootLayout>
<script>
  import RootLayout from "$pano/routes/RootLayout.svelte";

  let { View, data, props = {} } = $props();
  let show = $state(true);

  export function hide() {
    show = false;
  }
</script>`,
};

/** Replaces the parts of the engine this test does not exercise. */
const STUB_MODULES = {
  "layouts/AppLayout.svelte": `export default function AppLayout(target, props) { props.children?.(target); }`,
  "layouts/MainLayout.svelte": `export default function MainLayout(target, props) { props.children?.(target); }`,
  "sidebars/HomeSidebar.svelte": `export default function HomeSidebar() {}\nexport async function load() {}`,
  "sidebars/ProfileSidebar.svelte": `export default function ProfileSidebar() {}\nexport async function load() {}`,
  "sidebars/PluginSidebar.svelte": `export default function PluginSidebar() {}`,
  "kit/hooks-client.js": `export function markAppBooted() {}`,
};

const PLUGIN_API_FILE = join(import.meta.dir, "..", "PluginAPI.js");
/** The plugin API as PluginSlot and the plugin page see it: slots come from a table the test fills. */
const PLUGIN_API_STUB = `
import { readable } from "svelte/store";
export const panoApi = {
  ui: {
    view: { get: (id) => readable(globalThis.__tc53Slots?.[id] ?? []) },
    sidebar: { get: () => readable([]) },
  },
};
export const executeSidebarLoad = async () => ({});
`;

let workDir;
let compiler;
let render;
let clientSvelte;
let counter = 0;
const emitted = new Map();

function firstExisting(base) {
  for (const candidate of [base, `${base}.js`, `${base}.svelte`]) {
    if (existsSync(candidate)) {
      try {
        readFileSync(candidate);
        return candidate;
      } catch {
        // a directory
      }
    }
  }
  return null;
}

function clientStub(name, source) {
  const file = join(workDir, `client-${name}.mjs`);

  if (!existsSync(file)) writeFileSync(file, source);

  return file;
}

/** fallbackStyles.js for the browser run: Svelte's client entry points (a reactive SvelteSet), a module of its own. */
function emitClientFallbackStyles() {
  const out = join(workDir, "client-fallbackStyles.mjs");

  if (!existsSync(out)) {
    const code = readFileSync(fallbackStylesFile, "utf-8")
      .replace('from "svelte/reactivity"', `from ${JSON.stringify(join(svelteDir, "src", "reactivity", "index-client.js"))}`)
      .replace('from "svelte"', `from ${JSON.stringify(join(svelteDir, "src", "index-client.js"))}`);

    writeFileSync(out, code);
  }

  return out;
}

function target_(spec, from, mode) {
  if (mode === "client") {
    if (spec === "svelte") return join(svelteDir, "src", "index-client.js");
    if (spec === "$app/environment") return clientStub("environment", "export const browser = true; export const dev = false;");
    if (spec === "$app/paths") return clientStub("paths", 'export const base = "";');
    if (spec === "$app/stores") {
      return clientStub("stores", "export const page = { subscribe(run) { run(globalThis.__tc53ClientPage); return () => {}; } };");
    }
  }

  if (spec === "svelte" || spec.startsWith("svelte/")) return spec;
  if (spec.startsWith("@panomc/")) return Bun.resolveSync(spec, pkgSrc);

  let base = null;

  if (spec.startsWith("$pano/")) base = join(pkgSrc, spec.slice("$pano/".length));
  else if (spec.startsWith(".")) base = resolve(from, spec);

  if (!base) return spec; // $app/*, @sveltejs/kit: mocked

  const found = firstExisting(base);

  if (!found) throw new Error(`cannot resolve ${spec} from ${from}`);

  if (found.endsWith(".svelte")) return emit(found, mode);
  if (found === PLUGIN_API_FILE) return stubFile("plugin-api", PLUGIN_API_STUB);
  if (mode === "client" && found === fallbackStylesFile) return emitClientFallbackStyles();

  const stub = Object.entries(STUB_MODULES).find(([suffix]) => found.endsWith(suffix));

  return stub ? stubFile(stub[0], stub[1]) : found;
}

function stubFile(name, source) {
  const file = join(workDir, `stub-${name.replace(/[^\w]/g, "_")}.mjs`);

  if (!existsSync(file)) writeFileSync(file, source);

  return file;
}

/** Compiles a .svelte file (and, recursively, the .svelte files it imports) and returns the path of the module. */
function emit(file, mode = "server") {
  const cacheKey = `${mode}:${file}`;

  if (emitted.has(cacheKey)) return emitted.get(cacheKey);

  const stub = Object.entries(STUB_MODULES).find(([suffix]) => file.endsWith(suffix));

  if (stub) {
    const out = stubFile(stub[0], stub[1]);

    emitted.set(cacheKey, out);

    return out;
  }

  const out = join(workDir, `m${counter++}.mjs`);

  emitted.set(cacheKey, out);

  const { js } = compiler.compile(readFileSync(file, "utf-8"), { generate: mode, filename: file.split("/").pop() });
  const from = dirname(file);
  const code = js.code.replace(/(\bfrom\s*|\bimport\s*)(["'])([^"']+)\2/g, (whole, lead, _quote, spec) => {
    const target = target_(spec, from, mode);

    return target === spec ? whole : `${lead}${JSON.stringify(target)}`;
  });

  writeFileSync(out, code);

  return out;
}

const fixturePath = (name) => join(workDir, "fixtures", name);
const realPath = (rel) => join(pkgSrc, rel);
const build = (file, mode = "server") => import(emit(file, mode));

/** The compiled modules, by name, for the server and the browser. */
const modules = { server: {}, client: {} };
/** The compiled engine pieces. */
const engine = { server: {}, client: {} };

const ENGINE_FILES = {
  FallbackScope: "lib/components/FallbackScope.svelte",
  RootLayout: "routes/RootLayout.svelte",
  Page: "routes/plugin-ui/Page.svelte",
};

beforeAll(async () => {
  if (!hasSvelte) return;

  // inside node_modules (git-ignored): bun applies a mock only to importers that can resolve the specifier
  const scratch = join(pkgSrc, "..", "node_modules");

  mkdirSync(scratch, { recursive: true });
  workDir = mkdtempSync(join(scratch, ".tc53-"));
  mkdirSync(join(workDir, "fixtures"));

  for (const [name, source] of Object.entries(FIXTURES)) writeFileSync(fixturePath(name), source);

  compiler = await import(join(svelteDir, "src", "compiler", "index.js"));
  ({ render } = await import(join(svelteDir, "src", "server", "index.js")));

  for (const name of Object.keys(FIXTURES)) {
    modules.server[name.replace(".svelte", "")] = await build(fixturePath(name), "server");
  }

  for (const [name, rel] of Object.entries(ENGINE_FILES)) engine.server[name] = await build(realPath(rel), "server");

  engine.server.App = modules.server.App;
});

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });

  registry.resetRegistryForTests();
});

// ---------------------------------------------------------------------------
// A fixture plugin and a theme
// ---------------------------------------------------------------------------

const PLUGIN = "pano-plugin-tst";

const viewDef = (mode, name, file, extra = {}) => ({
  name,
  pluginId: PLUGIN,
  contract: 1,
  kind: "component",
  component: async () => modules[mode][file],
  ...extra,
});

/**
 * Registers the fixture plugin and a theme config, preloads every view and installs `views` (the registry plus the
 * fallback wrapper) in the pano context, as `processLoad` does. Returns the wrapper and the table that was used.
 */
async function installTheme(mode, { provides = { bootstrap: false, fontawesome: false }, overrides = {}, table = TABLE, wrapperModule = fallback, scope } = {}) {
  registry.resetRegistryForTests();
  registry.registerViews([
    viewDef(mode, "tst:Home", "Home", { kind: "page" }),
    viewDef(mode, "tst:Child", "Child"),
    viewDef(mode, "tst:Badge", "Badge"),
    viewDef(mode, "tst:Row", "Row"),
    viewDef(mode, "tst:Table", "Table"),
    viewDef(mode, "tst:Grid", "Grid", { block: true }),
    viewDef(mode, "tst:Promo", "Promo"),
    viewDef(mode, "tst:Shop", "Shop"),
  ]);

  const views = {};

  for (const [name, file] of Object.entries(overrides)) {
    views[name] = { contract: 1, component: async () => modules[mode][file] };
  }

  registry.setThemeConfig({ provides, views });
  await registry.preloadViews([
    "tst:Home", "tst:Child", "tst:Badge", "tst:Row", "tst:Table", "tst:Grid", "tst:Promo", "tst:Shop",
  ]);

  const wrapper = wrapperModule.createViewWrapper({
    FallbackScope: engine[mode].FallbackScope.default,
    getTable: () => table,
    getProvides: registry.getThemeProvides,
  });

  setPanoContext({
    views: {
      getOverride: registry.getOverride,
      getDefault: registry.getDefault,
      has: registry.hasView,
      wrap: wrapper.wrap,
    },
  });

  return { ...wrapper, table, scope };
}

afterEach(() => {
  const { context } = getPanoContext();

  delete context.views;
  delete globalThis.__tc53Slots;
  setActiveFallbackStyles(null);
});

/** A plugin view as a plugin build exposes it: the SDK proxy around the view's own component. */
const view = (mode, name, file) => createViewProxy(name, modules[mode][file].default);

const parse = (html) => {
  const doc = new Window().document;

  doc.body.innerHTML = html;

  return doc.body;
};

/** Renders `View` inside the real RootLayout; returns the page DOM and the head markup. */
function renderApp(View, { table = TABLE, props = {} } = {}) {
  pageState.current = { data: {}, url: new URL("http://localhost/"), params: {}, route: { id: "/" }, error: null };

  const { body, head } = render(engine.server.App.default, { props: { View, data: { pluginStyles: table }, props } });
  const headDom = new Window().document;

  headDom.head.innerHTML = head;

  return { body, head, root: parse(body), links: [...headDom.head.querySelectorAll("link")] };
}

const hrefs = (links) => links.map((link) => link.getAttribute("href"));

suite("server render in a theme without Bootstrap", () => {
  test("a default view is wrapped once; the views nested in it of the same plugin are not", async () => {
    await installTheme("server");

    const { root } = renderApp(view("server", "tst:Home", "Home"));
    const scopes = root.querySelectorAll(".pano-fb");

    expect(scopes.length).toBe(1);
    expect(scopes[0].getAttribute("data-pano-fb")).toBe("tst");
    expect(scopes[0].getAttribute("style")).toBe("display: contents");
    // the page is the wrapper's only child; Child (with its Badge) and the page's Badge sit directly in it
    expect(scopes[0].querySelector(":scope > section.home > .child-default > .badge").textContent).toBe("in-child");
    expect(scopes[0].querySelector(":scope > section.home > .badge").textContent).toBe("page-badge");
    expect(root.querySelectorAll(".pano-fb-stop").length).toBe(0);
  });

  test("a theme override nested in the scope gets a stop wrapper, and its default views start a scope again", async () => {
    await installTheme("server", { overrides: { "tst:Child": "ChildOverride" } });

    const { root } = renderApp(view("server", "tst:Home", "Home"));

    expect(root.querySelectorAll(".child-default").length).toBe(0);
    expect(root.querySelectorAll(".pano-fb").length).toBe(2);
    expect(root.querySelectorAll(".pano-fb-stop").length).toBe(1);

    const stop = root.querySelector(".pano-fb[data-pano-fb='tst'] > section.home > .pano-fb-stop");

    expect(stop).not.toBeNull();
    expect(stop.getAttribute("data-pano-fb")).toBeNull();
    expect(stop.querySelector(":scope > .child-override > .pano-fb[data-pano-fb='tst'] > .badge").textContent).toBe("in-override");
    // the page's own Badge is still unwrapped, a sibling of the stop wrapper
    expect(root.querySelector(".pano-fb > section.home > .badge").textContent).toBe("page-badge");
  });

  test("a table-row view gets no wrapper (a div around a <tr> would break the table)", async () => {
    await installTheme("server");

    const { root } = renderApp(view("server", "tst:Table", "Table"));

    expect(root.querySelectorAll(".pano-fb").length).toBe(1);
    expect(root.querySelector(".pano-fb > table.tbl > tbody > tr.row > td").textContent).toBe("cell");
    expect(root.querySelector("tbody .pano-fb")).toBeNull();
  });

  test("the links are in the SSR head: tokens first, then the keys the render collected", async () => {
    await installTheme("server");

    const { links } = renderApp(view("server", "tst:Home", "Home"));

    expect(hrefs(links)).toEqual([
      "/assets/css/pano-tokens.css",
      `/plugins/pano-plugin-tst/resources/plugin-ui/client/plugin.css?v=${HASH}`,
      "/assets/css/pano-fallback-icons.css",
      `/plugins/pano-plugin-tst/resources/plugin-ui/client/fallback.css?v=${HASH}`,
    ]);
    expect(links.every((link) => link.getAttribute("rel") === "stylesheet")).toBe(true);
    expect(links.slice(1).map((link) => link.getAttribute("data-pano-fb-style"))).toEqual(["own:tst", "icons", "tst"]);
    expect(links[0].getAttribute("data-pano-fb-style")).toBeNull();
  });

  test("Font Awesome provided: no icon sheet; the tokens and the fallback sheet stay", async () => {
    await installTheme("server", { provides: { bootstrap: false, fontawesome: true } });

    const { links } = renderApp(view("server", "tst:Home", "Home"));

    expect(hrefs(links).some((href) => href.includes("pano-fallback-icons"))).toBe(false);
    expect(hrefs(links)).toContain("/assets/css/pano-tokens.css");
    expect(hrefs(links).some((href) => href.includes("client/fallback.css"))).toBe(true);
  });

  test("a view the theme overrides with markup of its own asks for no fallback sheet, only the plugin's own one", async () => {
    await installTheme("server", { overrides: { "tst:Home": "GridOverride" } });

    // the page is the override: no scope above it, so no wrapper and no `tst` key
    const { root, links } = renderApp(view("server", "tst:Home", "Home"));

    expect(root.querySelector("ol.grid-override")).not.toBeNull();
    expect(root.querySelectorAll(".pano-fb, .pano-fb-stop").length).toBe(0);
    expect(hrefs(links).some((href) => href.includes("client/fallback.css"))).toBe(false);
    expect(hrefs(links).some((href) => href.includes("client/plugin.css"))).toBe(true);
  });

  test("PluginBlock: a default block is wrapped, an overridden block outside every scope is not", async () => {
    await installTheme("server");

    const plain = renderApp(modules.server.BlockHost.default);

    expect(plain.root.querySelectorAll(".pano-fb").length).toBe(1);
    expect(plain.root.querySelector(".pano-fb[data-pano-fb='tst'] > ul.grid")).not.toBeNull();

    await installTheme("server", { overrides: { "tst:Grid": "GridOverride" } });

    const overridden = renderApp(modules.server.BlockHost.default);

    expect(overridden.root.querySelector("ol.grid-override")).not.toBeNull();
    expect(overridden.root.querySelectorAll(".pano-fb, .pano-fb-stop").length).toBe(0);
  });

  test("PluginBlock inside a default view of its plugin: no second wrapper", async () => {
    await installTheme("server");

    const { root } = renderApp(view("server", "tst:Shop", "Shop"));

    expect(root.querySelectorAll(".pano-fb").length).toBe(1);
    expect(root.querySelector(".pano-fb > div.shop > ul.grid")).not.toBeNull();
  });

  test("PluginBlock: an overridden block inside a default view of its plugin gets a stop wrapper", async () => {
    await installTheme("server", { overrides: { "tst:Grid": "GridOverride" } });

    const { root } = renderApp(view("server", "tst:Shop", "Shop"));

    expect(root.querySelector(".pano-fb > div.shop > .pano-fb-stop > ol.grid-override")).not.toBeNull();
  });

  test("PluginSlot: an injected default view is wrapped, an injected override is not", async () => {
    await installTheme("server");

    globalThis.__tc53Slots = {
      "tst:slot": [{ id: "promo", view: "tst:Promo", component: modules.server.Promo, props: {} }],
    };

    const plain = renderApp(modules.server.SlotHost.default);

    expect(plain.root.querySelector(".pano-fb[data-pano-fb='tst'] > span.promo")).not.toBeNull();

    await installTheme("server", { overrides: { "tst:Promo": "PromoOverride" } });

    globalThis.__tc53Slots = {
      "tst:slot": [{ id: "promo", view: "tst:Promo", component: modules.server.PromoOverride, props: {} }],
    };

    const overridden = renderApp(modules.server.SlotHost.default);

    expect(overridden.root.querySelector("b.promo-override")).not.toBeNull();
    expect(overridden.root.querySelectorAll(".pano-fb, .pano-fb-stop").length).toBe(0);
  });

  test("PluginSlot: an item that names no view, or whose module has not loaded yet, renders as before", async () => {
    await installTheme("server");

    globalThis.__tc53Slots = {
      "tst:slot": [
        { id: "legacy", component: modules.server.Promo, props: {} },
        { id: "thunk", view: "tst:Promo", component: async () => modules.server.Promo, props: {} },
      ],
    };

    const { root } = renderApp(modules.server.SlotHost.default);

    expect(root.querySelectorAll("span.promo").length).toBe(1);
    expect(root.querySelectorAll(".pano-fb").length).toBe(0);
  });

  test("the plugin page: a default view is wrapped (server branch), an override renders as it is", async () => {
    await installTheme("server");

    const data = {
      registeredPage: { view: "tst:Home" },
      component: modules.server.Home,
      props: {},
      viewSource: "default",
    };

    const page = renderApp(engine.server.Page.default, { props: { data } });

    expect(page.root.querySelectorAll(".pano-fb").length).toBe(1);
    expect(page.root.querySelector(".pano-fb[data-pano-fb='tst'] > section.home")).not.toBeNull();
    expect(hrefs(page.links).some((href) => href.includes("client/fallback.css"))).toBe(true);

    const overridden = renderApp(engine.server.Page.default, {
      props: { data: { ...data, component: modules.server.ChildOverride, viewSource: "override" } },
    });

    expect(overridden.root.querySelector(".child-override")).not.toBeNull();
    expect(overridden.root.querySelectorAll(".pano-fb-stop").length).toBe(0);
    // its nested default Badge starts a scope of its own
    expect(overridden.root.querySelector(".child-override > .pano-fb > .badge")).not.toBeNull();
  });

  test("a legacy plugin page (no view name) renders as before", async () => {
    await installTheme("server");

    const { root } = renderApp(engine.server.Page.default, {
      props: { data: { registeredPage: {}, component: modules.server.Child, props: {}, viewSource: "default" } },
    });

    expect(root.querySelector(".child-default")).not.toBeNull();
    expect(root.querySelector(".child-default > .pano-fb > .badge")).not.toBeNull();
    expect(root.querySelectorAll(".pano-fb").length).toBe(1);
  });

  test("two renders in a row do not share their stylesheets (the store belongs to the render)", async () => {
    await installTheme("server", { overrides: { "tst:Home": "GridOverride" } });

    const first = renderApp(view("server", "tst:Child", "Child"));

    expect(hrefs(first.links).some((href) => href.includes("client/fallback.css"))).toBe(true);

    const second = renderApp(view("server", "tst:Home", "Home"));

    expect(hrefs(second.links).some((href) => href.includes("client/fallback.css"))).toBe(false);
    expect(hrefs(second.links)).toEqual([
      "/assets/css/pano-tokens.css",
      `/plugins/pano-plugin-tst/resources/plugin-ui/client/plugin.css?v=${HASH}`,
    ]);
  });
});

suite("server render in a theme that provides Bootstrap", () => {
  test("nothing changes except the own: link: no wrappers, no tokens, no fallback sheet", async () => {
    await installTheme("server", { provides: { bootstrap: true, fontawesome: true } });

    const { root, links } = renderApp(view("server", "tst:Home", "Home"));

    expect(root.querySelectorAll(".pano-fb, .pano-fb-stop").length).toBe(0);
    expect(root.querySelector("section.home > .child-default > .badge")).not.toBeNull();
    expect(hrefs(links)).toEqual([`/plugins/pano-plugin-tst/resources/plugin-ui/client/plugin.css?v=${HASH}`]);
  });

  test("the default config (no provides at all) is a Bootstrap theme", async () => {
    await installTheme("server", { provides: null });

    const { root, links } = renderApp(view("server", "tst:Home", "Home"));

    expect(root.querySelectorAll(".pano-fb").length).toBe(0);
    expect(hrefs(links)).toEqual([`/plugins/pano-plugin-tst/resources/plugin-ui/client/plugin.css?v=${HASH}`]);
  });

  test("the icon rule: no Font Awesome in the theme gives the icon sheet even with Bootstrap", async () => {
    await installTheme("server", { provides: { bootstrap: true, fontawesome: false } });

    const { links } = renderApp(view("server", "tst:Home", "Home"));

    expect(hrefs(links)).toEqual([
      `/plugins/pano-plugin-tst/resources/plugin-ui/client/plugin.css?v=${HASH}`,
      "/assets/css/pano-fallback-icons.css",
    ]);
  });

  test("a plugin without any styles adds no link at all", async () => {
    await installTheme("server", { provides: { bootstrap: true, fontawesome: true }, table: {} });

    const { links } = renderApp(view("server", "tst:Home", "Home"), { table: {} });

    expect(links.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The browser (happy-dom)
// ---------------------------------------------------------------------------

suite("the browser", () => {
  const dom = new Window();
  const DOM_GLOBALS = [
    "window", "document", "navigator", "Node", "Element", "HTMLElement", "HTMLTemplateElement", "HTMLInputElement",
    "HTMLSelectElement", "HTMLTextAreaElement", "HTMLFormElement", "HTMLImageElement", "HTMLIFrameElement",
    "HTMLMediaElement", "ShadowRoot", "Text", "Comment", "DocumentFragment", "Event", "CustomEvent", "MouseEvent",
    "KeyboardEvent", "InputEvent", "MutationObserver", "getComputedStyle", "requestAnimationFrame",
    "cancelAnimationFrame", "customElements",
  ];
  const saved = new Map();
  let clientFallback;

  beforeAll(async () => {
    for (const key of DOM_GLOBALS) {
      saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));

      const value = key === "window" ? dom : dom[key];

      if (value === undefined) continue;

      Object.defineProperty(globalThis, key, {
        value: typeof value === "function" && !/^[A-Z]/.test(key) ? value.bind(dom) : value,
        configurable: true,
        writable: true,
      });
    }

    clientSvelte = await import(join(svelteDir, "src", "index-client.js"));

    for (const name of Object.keys(FIXTURES)) modules.client[name.replace(".svelte", "")] = await build(fixturePath(name), "client");
    for (const [name, rel] of Object.entries(ENGINE_FILES)) engine.client[name] = await build(realPath(rel), "client");

    engine.client.App = modules.client.App;
    clientFallback = await import(emitClientFallbackStyles());
  });

  afterAll(() => {
    for (const key of DOM_GLOBALS) {
      const was = saved.get(key);

      if (was) Object.defineProperty(globalThis, key, was);
      else delete globalThis[key];
    }
  });

  beforeEach(() => {
    dom.document.head.innerHTML = "";
    dom.document.body.innerHTML = "";
  });

  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await Promise.resolve();
      clientSvelte.flushSync();
    }
  };

  async function mountApp(View, props = {}) {
    globalThis.__tc53ClientPage = { data: {}, url: new URL("http://localhost/"), params: {}, route: { id: "/" }, error: null };

    const target = dom.document.createElement("div");

    dom.document.body.appendChild(target);

    const instance = clientSvelte.mount(engine.client.App.default, {
      target,
      props: { View, data: { pluginStyles: TABLE }, props },
    });

    await settle();

    return { target, instance };
  }

  const headHrefs = () => [...dom.document.head.querySelectorAll("link")].map((link) => link.getAttribute("href"));

  test("destroying the first wrapped view keeps the link: keys are never removed during the session", async () => {
    await installTheme("client", { wrapperModule: clientFallback });

    const { target, instance } = await mountApp(view("client", "tst:Home", "Home"));

    expect(target.querySelectorAll(".pano-fb[data-pano-fb='tst']").length).toBe(1);
    expect(target.querySelectorAll(".pano-fb .child-default .badge").length).toBe(1);
    expect(headHrefs()).toContain(`/plugins/pano-plugin-tst/resources/plugin-ui/client/fallback.css?v=${HASH}`);
    expect(headHrefs()).toContain("/assets/css/pano-tokens.css");

    instance.hide();
    await settle();

    expect(target.querySelectorAll(".pano-fb").length).toBe(0);
    expect(headHrefs()).toContain(`/plugins/pano-plugin-tst/resources/plugin-ui/client/fallback.css?v=${HASH}`);
    expect(headHrefs()).toContain(`/plugins/pano-plugin-tst/resources/plugin-ui/client/plugin.css?v=${HASH}`);

    clientSvelte.unmount(instance);
  });

  test("an override nested in a default view gets the stop wrapper in the browser too", async () => {
    await installTheme("client", { wrapperModule: clientFallback, overrides: { "tst:Child": "ChildOverride" } });

    const { target, instance } = await mountApp(view("client", "tst:Home", "Home"));

    expect(target.querySelectorAll(".pano-fb").length).toBe(2);
    expect(target.querySelector(".pano-fb > section.home > .pano-fb-stop > .child-override > .pano-fb > .badge")).not.toBeNull();

    clientSvelte.unmount(instance);
  });

  test("the plugin page mounted by hand: the container is the scope, the mounted view opens none of its own", async () => {
    await installTheme("client", { wrapperModule: clientFallback });

    const data = { registeredPage: { view: "tst:Home" }, component: modules.client.Home, props: {}, viewSource: "default" };
    const { target, instance } = await mountApp(engine.client.Page.default, { data });

    const container = target.querySelector(".plugin-view-container");

    expect(container).not.toBeNull();
    expect(container.classList.contains("pano-fb")).toBe(true);
    expect(container.getAttribute("data-pano-fb")).toBe("tst");
    // the view mounted into it: no wrapper of its own, the nested default views none either
    expect(container.querySelector("section.home > .child-default > .badge")).not.toBeNull();
    expect(target.querySelectorAll(".pano-fb").length).toBe(1);
    expect(headHrefs()).toContain(`/plugins/pano-plugin-tst/resources/plugin-ui/client/fallback.css?v=${HASH}`);

    clientSvelte.unmount(instance);
  });

  test("the plugin page mounted by hand in a Bootstrap theme: a plain container", async () => {
    await installTheme("client", { wrapperModule: clientFallback, provides: { bootstrap: true, fontawesome: true } });

    const data = { registeredPage: { view: "tst:Home" }, component: modules.client.Home, props: {}, viewSource: "default" };
    const { target, instance } = await mountApp(engine.client.Page.default, { data });

    const container = target.querySelector(".plugin-view-container");

    expect(container.className).toBe("plugin-view-container");
    expect(container.getAttribute("data-pano-fb")).toBeNull();
    expect(target.querySelectorAll(".pano-fb").length).toBe(0);
    expect(headHrefs()).toEqual([`/plugins/pano-plugin-tst/resources/plugin-ui/client/plugin.css?v=${HASH}`]);

    clientSvelte.unmount(instance);
  });
});

// ---------------------------------------------------------------------------
// The wiring that is not rendered here
// ---------------------------------------------------------------------------

describe("wiring", () => {
  const read = (rel) => readFileSync(join(pkgSrc, rel), "utf-8");

  test("AppLayoutLogics builds the wrapper per load, keeps `wrap: wrapView` and `wrapInjected` in the pano context and hands the table to the browser", () => {
    const source = read("lib/ui-logics/layout-logics/AppLayoutLogics.js");

    expect(source).toContain("viewWrapper = createViewWrapper(");
    expect(source).toMatch(/views:\s*{\s*getOverride,\s*getDefault,\s*has:\s*hasView,\s*wrap:\s*wrapView,\s*wrapInjected:\s*wrapInjectedView,?\s*}/);
    // the server load reads pano-plugin.json; the universal load returns the table for RootLayout
    expect(source).toMatch(/pluginStyles,\s*\n\s*apiUrlEnv/);
    expect(source).toMatch(/session: { user, csrfToken, siteInfo },\s*\n\s*pluginStyles,/);
  });

  test("the plugin page, RootLayout and the cache rule are wired", () => {
    // after the page, in a child component (a <svelte:head> in RootLayout itself would be emitted before the page)
    expect(read("routes/RootLayout.svelte")).toMatch(/<\/AppLayout>[\s\S]*<FallbackLinks \{styles\} \{plugins\} \{provides\} \/>/);
    expect(read("routes/RootLayout.svelte")).not.toContain("<svelte:head>");
    expect(read("lib/components/FallbackLinks.svelte")).toContain("<svelte:head>");
    expect(read("routes/plugins-client-file.js")).toContain('url?.searchParams?.has("v")');
  });
});

// ---------------------------------------------------------------------------
// theme-core new --bare
// ---------------------------------------------------------------------------

describe("theme-core new --bare", () => {
  const newJs = join(pkgSrc, "..", "bin", "new.js");
  let root;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "tc53-new-"));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function scaffold(name, flags) {
    const result = Bun.spawnSync(["bun", newJs, name, "--local", ...flags], { cwd: root, stdout: "pipe", stderr: "pipe" });

    expect(result.exitCode).toBe(0);

    return join(root, name);
  }

  test("writes provides, a tokens.css with every token, a style.scss without Bootstrap and no Bootstrap dependency", () => {
    const dir = scaffold("bare-theme", ["--bare"]);
    const config = readFileSync(join(dir, "theme.config.js"), "utf-8");
    const tokens = readFileSync(join(dir, "src/styles/tokens.css"), "utf-8");
    const style = readFileSync(join(dir, "src/styles/style.scss"), "utf-8");
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    const generated = readFileSync(join(pkgSrc, "..", "..", "sdk", "core", "css", "pano-tokens.css"), "utf-8");

    expect(config).toContain("provides: { bootstrap: false, fontawesome: false }");

    // every --pano-* token of the engine, prefilled with its light value
    const light = generated.match(/:root,\s*\[data-bs-theme='light'\]\s*\{([^}]*)\}/)[1];
    const names = [...light.matchAll(/(--pano-[\w-]+)\s*:\s*([^;]+);/g)];

    expect(names.length).toBe(34);

    const block = tokens.match(/:root\s*\{([^}]*)\}/)[1];

    for (const [, token, value] of names) expect(block).toContain(`${token}: ${value.trim()};`);

    expect(tokens).toContain("[data-bs-theme='copper']");
    expect(existsSync(join(dir, "src/styles/tokens.scss"))).toBe(false);

    expect(style).toContain('@use "tokens";');
    expect(style).not.toMatch(/bootstrap|fontawesome|main"/);
    expect(pkg.devDependencies.bootstrap).toBeUndefined();
    expect(pkg.devDependencies["animate.css"]).toBeUndefined();
  });

  test("without --bare the scaffold is what it was: no provides, tokens.scss, Bootstrap in the styles", () => {
    const dir = scaffold("plain-theme", []);

    expect(readFileSync(join(dir, "theme.config.js"), "utf-8")).not.toContain("provides");
    expect(existsSync(join(dir, "src/styles/tokens.scss"))).toBe(true);
    expect(existsSync(join(dir, "src/styles/tokens.css"))).toBe(false);
    expect(readFileSync(join(dir, "src/styles/style.scss"), "utf-8")).toContain("core/scss/main");
    expect(JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")).devDependencies.bootstrap).toBeDefined();
  });
});
