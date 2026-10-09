import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Window } from "happy-dom";
import { writable } from "svelte/store";

import { findSvelte } from "./svelteSsr.helper.js";

// TC-30: the engine wiring of PluginBlock, PluginSlot, the views in the pano context and the plugin page.
//
// The real files are compiled with the Svelte compiler (server mode) and run against the REAL registry and the
// REAL plugin API; only the SvelteKit aliases are stubs. The fixtures stand for a plugin (`tst`, three default
// views, a block, two injections) and for a theme (overrides, a hand-built theme meta).

// ---------------------------------------------------------------------------
// Stubs of the SvelteKit aliases (bun mocks are process-wide: every stub is a superset of what other suites use)
// ---------------------------------------------------------------------------

class Redirect {
  constructor(status, location) {
    this.status = status;
    this.location = location;
  }
}

const pageState = { current: { data: {}, url: new URL("http://localhost/"), params: {} } };
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
mock.module("$pano/lib/services/auth.js", () => ({ sendLogout: async () => {} }));
mock.module("$pano/lib/components/ToastContainer.svelte", () => ({
  show: async () => {},
  showSuccess: async () => {},
  showError: async () => {},
  limitTitle: (text) => text,
}));
const pluginManagerStub = () => ({
  plugins: writable({}),
  registeredPages: {},
  findMatch: () => null,
});
mock.module("@panomc/sdk/core/js/PluginManager.js", pluginManagerStub);
mock.module(new URL("../../../../sdk/core/js/PluginManager.js", import.meta.url).pathname, pluginManagerStub);
const returnToUtil = await import("../returnTo.util.js");
mock.module("$pano/lib/returnTo.util.js", () => returnToUtil);
const sdkPluginApi = await import("../../../../sdk/core/js/PluginAPI.js");
mock.module("@panomc/sdk/core/js/PluginAPI", () => sdkPluginApi);

const registry = await import("../../registry/index.js");
const { getPanoContext, setPanoContext } = await import("../../../../sdk/src/internal/index.js");

const PLUGIN_API_FILE = join(import.meta.dir, "..", "PluginAPI.js");
// one PluginAPI instance for the test and for the compiled components (they import it as `$pano/lib/PluginAPI.js`)
const PLUGIN_API_SPEC = `${PLUGIN_API_FILE}?engineWiring`;
const api = await import(PLUGIN_API_SPEC);
const { panoApi, init, executeViewLoad } = api;

// ---------------------------------------------------------------------------
// A tiny build of .svelte files: server mode, imports rewritten to files
// ---------------------------------------------------------------------------

const svelteDir = findSvelte();
const pkgSrc = join(import.meta.dir, "..", "..");

const FIXTURES = {
  "Badge.svelte": `<script>
  let { text = "" } = $props();
</script>
<span class="badge">{text}</span>`,

  "Child.svelte": `<script module>
  import { createViewProxy } from "@panomc/sdk/views";
  import BadgeDefault from "./Badge.svelte";

  const Badge = createViewProxy("tst:Badge", BadgeDefault);
</script>
<script>
  let { label = "" } = $props();
</script>
<div class="child-default"><b class="label">{label}</b><Badge text="in-child" /></div>`,

  "ChildOverride.svelte": `<script module>
  import { createViewProxy } from "@panomc/sdk/views";
  import BadgeDefault from "./Badge.svelte";

  const Badge = createViewProxy("tst:Badge", BadgeDefault);
</script>
<script>
  let { label = "" } = $props();
</script>
<div class="child-override"><b class="label">{label}</b><Badge text="in-override" /></div>`,

  "Home.svelte": `<script module>
  import { createViewProxy } from "@panomc/sdk/views";
  import ChildDefault from "./Child.svelte";
  import BadgeDefault from "./Badge.svelte";

  const Child = createViewProxy("tst:Child", ChildDefault);
  const Badge = createViewProxy("tst:Badge", BadgeDefault);

  export async function load() {
    return { title: "from-default-load", pageTitle: "tst.title" };
  }
</script>
<script>
  let { title = "" } = $props();
</script>
<section class="home-default"><h1>{title}</h1><Child label="one" /><Badge text="page-badge" /></section>`,

  "HomeOverride.svelte": `<script module>
  import { pluginView } from "$pano/registry/view.js";
  import PluginBlock from "$pano/lib/components/PluginBlock.svelte";

  const Child = pluginView("tst:Child");

  // a load exported by an override is ignored (doc 01 section 4, rule 4)
  export async function load() {
    return { title: "from-override-load" };
  }
</script>
<script>
  let { title = "" } = $props();
</script>
<main class="home-override">
  <h1>{title}</h1>
  <Child label="nested" />
  <div class="four"><PluginBlock id="tst:Grid" limit={4} /></div>
  <div class="eight"><PluginBlock id="tst:Grid" limit={8} /></div>
</main>`,

  "Grid.svelte": `<script module>
  export async function load(event, props) {
    globalThis.__engineWiringGridLoads = (globalThis.__engineWiringGridLoads ?? 0) + 1;
    return { items: Array.from({ length: props.limit ?? 0 }, (_, i) => i + 1), fromEvent: event?.marker ?? null };
  }
</script>
<script>
  let { items = [], limit = 0 } = $props();
</script>
<ul class="grid" data-limit={limit}>{#each items as n (n)}<li>{n}</li>{/each}</ul>`,

  "NavCart.svelte": `<script module>
  export async function load() {
    globalThis.__engineWiringLoads = (globalThis.__engineWiringLoads ?? 0) + 1;
    return { loaded: true };
  }
</script>
<script>
  let { order = "none", data = {} } = $props();
</script>
<span class="navcart" data-order={order} data-loaded={String(!!data.loaded)}>cart</span>`,

  "Promo.svelte": `<span class="promo">promo</span>`,

  "BlockHost.svelte": `<script>
  import PluginBlock from "$pano/lib/components/PluginBlock.svelte";

  let { id } = $props();
</script>
<PluginBlock {id}>
  {#snippet fallback()}<i class="fb">fallback</i>{/snippet}
</PluginBlock>`,
};

const STUB_MODULES = {
  // the host sidebars and the plugin sidebar are not part of what TC-30 tests
  "sidebars/HomeSidebar.svelte": `export default function HomeSidebar() {}\nexport async function load() {}`,
  "sidebars/ProfileSidebar.svelte": `export default function ProfileSidebar() {}\nexport async function load() {}`,
  "sidebars/PluginSidebar.svelte": `export default function PluginSidebar() {}`,
};

let workDir;
let compiler;
let render;
const emitted = new Map();
let counter = 0;

function firstExisting(base) {
  for (const candidate of [base, `${base}.js`, `${base}.svelte`]) {
    if (existsSync(candidate) && !candidate.endsWith("/")) {
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

/** Compiles a .svelte file (and, recursively, the .svelte files it imports) and returns the path of the module. */
function emit(file, mode = "server") {
  const cacheKey = `${mode}:${file}`;
  if (emitted.has(cacheKey)) return emitted.get(cacheKey);

  const out = join(workDir, `m${counter++}.mjs`);
  emitted.set(cacheKey, out);

  const stub = Object.entries(STUB_MODULES).find(([suffix]) => file.endsWith(suffix));
  if (stub) {
    writeFileSync(out, stub[1]);
    return out;
  }

  const source = readFileSync(file, "utf-8");
  const { js } = compiler.compile(source, { generate: mode, filename: file.split("/").pop() });
  const from = dirname(file);
  const code = js.code.replace(/(\bfrom\s*|\bimport\s*)(["'])([^"']+)\2/g, (whole, lead, quote, spec) => {
    const target = target_(spec, from, mode);
    return target === spec ? whole : `${lead}${JSON.stringify(target)}`;
  });
  writeFileSync(out, code);
  return out;
}

function target_(spec, from, mode = "server") {
  if (mode === "client") {
    // the client build runs under bun: the browser entry of Svelte and a stub for the aliases
    if (spec === "svelte") return join(svelteDir, "src", "index-client.js");
    if (spec === "$app/environment") return clientStub("environment", "export const browser = true; export const dev = false;");
    if (spec === "$app/stores") {
      return clientStub("stores", "export const page = { subscribe(run) { run(globalThis.__engineWiringClientPage); return () => {}; } };");
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
  return found === PLUGIN_API_FILE ? PLUGIN_API_SPEC : found;
}

function clientStub(name, source) {
  const file = join(workDir, `client-${name}.mjs`);
  if (!existsSync(file)) writeFileSync(file, source);
  return file;
}

const fixturePath = (name) => join(workDir, "fixtures", name);
const realPath = (rel) => join(pkgSrc, rel);
/** The compiled module of a fixture or of a real engine file. */
const build = (file) => import(emit(file));

const modules = {};
let PluginBlock;
let PluginSlot;
let PageModule;

beforeAll(async () => {
  // inside node_modules (git-ignored): bun applies a mock only to importers that can resolve the specifier
  const scratch = join(pkgSrc, "..", "node_modules");
  mkdirSync(scratch, { recursive: true });
  workDir = mkdtempSync(join(scratch, ".tc30-"));
  mkdirSync(join(workDir, "fixtures"));
  for (const [name, source] of Object.entries(FIXTURES)) writeFileSync(fixturePath(name), source);

  compiler = await import(join(svelteDir, "src", "compiler", "index.js"));
  ({ render } = await import(join(svelteDir, "src", "server", "index.js")));

  for (const name of Object.keys(FIXTURES)) modules[name.replace(".svelte", "")] = await build(fixturePath(name));

  PluginBlock = (await build(realPath("lib/components/PluginBlock.svelte"))).default;
  PluginSlot = (await build(realPath("lib/components/PluginSlot.svelte"))).default;
  PageModule = await build(realPath("routes/plugin-ui/Page.svelte"));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
  registry.resetRegistryForTests();
});

// ---------------------------------------------------------------------------
// Fixture plugin + theme
// ---------------------------------------------------------------------------

const PLUGIN = "pano-plugin-tst";

const viewDef = (name, file, extra = {}) => ({
  name,
  pluginId: PLUGIN,
  contract: 1,
  kind: "component",
  component: async () => modules[file],
  ...extra,
});

function registerPlugin() {
  panoApi.views.add([
    viewDef("tst:Home", "Home", { kind: "page", uses: ["tst:Child", "tst:Badge"] }),
    viewDef("tst:Child", "Child", { uses: ["tst:Badge"] }),
    viewDef("tst:Badge", "Badge"),
    viewDef("tst:Grid", "Grid", { block: true }),
    viewDef("tst:NavCart", "NavCart", { inject: [{ slot: "tst:cart-slot", id: "navcart", priority: 20 }] }),
    viewDef("tst:Promo", "Promo", { inject: [{ slot: "tst:cart-slot", id: "promo", priority: 10 }] }),
  ]);
}

const override = (file, extra = {}) => ({ contract: 1, component: async () => modules[file], ...extra });

/** What AppLayoutLogics puts into the pano context (`views`). */
function installViewsContext() {
  setPanoContext({
    views: {
      getOverride: registry.getOverride,
      getDefault: registry.getDefault,
      has: registry.hasView,
      wrap: (_name, component) => component,
    },
  });
}

const parse = (html) => {
  const doc = new Window().document;
  doc.body.innerHTML = html;
  return doc.body;
};

const serverEvent = (extra = {}) => ({
  url: new URL("http://localhost/tst"),
  params: {},
  parent: async () => ({}),
  ...extra,
});

/** Runs the plugin page load and renders the page the way the route does. */
async function renderPluginPage(view = "tst:Home") {
  const event = serverEvent({
    parent: async () => ({
      registeredPage: { view, component: () => registry.loadForInjection(view) },
    }),
  });
  const data = await PageModule.load(event);

  pageState.current = { data, url: event.url, params: {} };

  const { body } = render(PageModule.default, { props: { data } });

  return { data, body, root: parse(body) };
}

let warnSpy;
let errorSpy;

beforeEach(async () => {
  registry.resetRegistryForTests();
  await init();
  warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = spyOn(console, "error").mockImplementation(() => {});
  globalThis.__engineWiringLoads = 0;
  globalThis.__engineWiringGridLoads = 0;
  pageState.current = { data: {}, url: new URL("http://localhost/"), params: {} };
  registry.setThemeConfig({});
  registry.setThemeMeta(null);
  registerPlugin();
  installViewsContext();
});

afterEach(async () => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
  const { context } = getPanoContext();
  delete context.views;
  await init();
  registry.resetRegistryForTests();
});

// ---------------------------------------------------------------------------

describe("plugin page (routes/plugin-ui/Page.svelte)", () => {
  test("no override: the default renders, source is default, the load is the default's", async () => {
    const { data, root } = await renderPluginPage();

    expect(data.viewSource).toBe("default");
    expect(data.props).toEqual({ title: "from-default-load", pageTitle: "tst.title" });
    expect(data.pageTitle).toBe("tst.title");
    expect(root.querySelector("section.home-default h1").textContent).toBe("from-default-load");
    expect(root.querySelector(".home-default .child-default .label").textContent).toBe("one");
    expect(root.querySelectorAll(".child-override").length).toBe(0);
  });

  test("a default page with a nested override: the override lands in the page, the page's own badge stays after it", async () => {
    registry.setThemeConfig({ views: { "tst:Child": override("ChildOverride") } });

    const { data, root } = await renderPluginPage();

    expect(data.viewSource).toBe("default");
    expect(root.querySelectorAll(".child-default").length).toBe(0);
    expect(root.querySelector("section.home-default > .child-override .label").textContent).toBe("one");
    // a default Badge inside the override is the plugin's
    expect(root.querySelector(".child-override .badge").textContent).toBe("in-override");
    expect(root.querySelector("section.home-default > .badge").textContent).toBe("page-badge");

    const order = [...root.querySelectorAll("section.home-default > *")].map((n) => n.className || n.tagName.toLowerCase());
    expect(order).toEqual(["h1", "child-override", "badge"]);
  });

  test("an override page with a nested default: native render, the nested default Child is the plugin's", async () => {
    registry.setThemeConfig({ views: { "tst:Home": override("HomeOverride") } });
    registry.setThemeMeta({
      refs: {
        "tst:Home": [{ id: "tst:Child" }, { id: "tst:Grid", props: { limit: 4 } }, { id: "tst:Grid", props: { limit: 8 } }],
      },
    });

    const { data, root } = await renderPluginPage();

    expect(data.viewSource).toBe("override");
    expect(root.querySelectorAll(".home-default").length).toBe(0);
    expect(root.querySelector("main.home-override h1").textContent).toBe("from-default-load");
    expect(root.querySelector("main.home-override .child-default .label").textContent).toBe("nested");
    // the default Child renders its own default Badge through the proxy
    expect(root.querySelector("main.home-override .child-default .badge").textContent).toBe("in-child");
  });

  test("override data equals the default's load; the override's own load is ignored", async () => {
    const plain = await renderPluginPage();

    registry.setThemeConfig({ views: { "tst:Home": override("HomeOverride") } });
    registry.setThemeMeta({ refs: { "tst:Home": [{ id: "tst:Child" }] } });

    const overridden = await renderPluginPage();

    expect(overridden.data.props).toEqual(plain.data.props);
    expect(overridden.data.props.title).not.toBe("from-override-load");
    expect(overridden.data.pageTitle).toBe(plain.data.pageTitle);
    expect(overridden.data.component.load).toBe(plain.data.component.load);
  });

  test("an override with another contract falls back to the default and renders it bridged (source default)", async () => {
    registry.setThemeConfig({ views: { "tst:Home": override("HomeOverride", { contract: 7 }) } });

    const { data, root } = await renderPluginPage();

    expect(data.viewSource).toBe("default");
    expect(root.querySelectorAll(".home-override").length).toBe(0);
    expect(root.querySelector(".home-default")).not.toBeNull();
    expect(registry.getIssues().map((issue) => issue.type)).toContain("CONTRACT_MISMATCH");
  });

  test("two grids with different limit get different data, each at its own key", async () => {
    registry.setThemeConfig({ views: { "tst:Home": override("HomeOverride") } });
    registry.setThemeMeta({
      refs: { "tst:Home": [{ id: "tst:Grid", props: { limit: 4 } }, { id: "tst:Grid", props: { limit: 8 } }] },
    });

    const { data, root } = await renderPluginPage();

    const keys = Object.keys(data).filter((key) => key.startsWith("block:"));
    expect(keys.sort()).toEqual(['block:tst:Grid#{"limit":4}', 'block:tst:Grid#{"limit":8}']);
    expect(data['block:tst:Grid#{"limit":4}'].items).toEqual([1, 2, 3, 4]);
    expect(data['block:tst:Grid#{"limit":8}'].items.length).toBe(8);

    expect(root.querySelectorAll(".four .grid li").length).toBe(4);
    expect(root.querySelectorAll(".eight .grid li").length).toBe(8);
    expect(root.querySelector(".four .grid").getAttribute("data-limit")).toBe("4");
    expect(root.querySelector(".eight .grid").getAttribute("data-limit")).toBe("8");
  });

  test("a view the registry does not know is a 404, not a crash on a missing module", async () => {
    const event = serverEvent({
      parent: async () => ({ registeredPage: { view: "ghost:Page", component: async () => null } }),
    });

    await expect(PageModule.load(event)).rejects.toMatchObject({ status: 404 });
  });

  test("a page registered with a component (no view) keeps working: no registry, source default", async () => {
    const event = serverEvent({
      parent: async () => ({
        registeredPage: { component: async () => ({ default: () => {}, load: async () => ({ x: 1 }) }) },
      }),
    });
    const data = await PageModule.load(event);

    expect(data.viewSource).toBe("default");
    expect(data.props).toEqual({ x: 1 });
    expect(Object.keys(data).filter((key) => key.startsWith("block:"))).toEqual([]);
  });
});

describe("PluginBlock", () => {
  const renderBlock = (props, data = {}) => {
    pageState.current = { data, url: new URL("http://localhost/"), params: {} };
    return parse(render(PluginBlock, { props }).body);
  };

  test("reads the data of its own placement from $page.data, props win over data", async () => {
    await registry.preloadViews(["tst:Grid"]);

    const root = renderBlock(
      { id: "tst:Grid", limit: 2 },
      { 'block:tst:Grid#{"limit":2}': { items: ["a", "b"], limit: 99 }, 'block:tst:Grid#{"limit":3}': { items: ["x"] } },
    );

    expect([...root.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["a", "b"]);
    expect(root.querySelector(".grid").getAttribute("data-limit")).toBe("2");
  });

  test("the key is missing: it renders with its props only (the browser load happens after mount)", async () => {
    await registry.preloadViews(["tst:Grid"]);

    const root = renderBlock({ id: "tst:Grid", limit: 3 });

    expect(root.querySelector(".grid").getAttribute("data-limit")).toBe("3");
    expect(root.querySelectorAll("li").length).toBe(0);
  });

  test("prefers the override, falls back to the default", async () => {
    registry.setThemeConfig({ views: { "tst:Child": override("ChildOverride") } });
    await registry.preloadViews(["tst:Child"]);

    expect(renderBlock({ id: "tst:Child", label: "x" }).querySelector(".child-override .label").textContent).toBe("x");

    registry.setThemeConfig({});
    await registry.preloadViews(["tst:Child"]);

    expect(renderBlock({ id: "tst:Child", label: "y" }).querySelector(".child-default .label").textContent).toBe("y");
  });

  test("an unknown id renders nothing, or the fallback snippet", async () => {
    expect(renderBlock({ id: "nope:Missing" }).querySelectorAll("*").length).toBe(0);

    const host = await build(fixturePath("BlockHost.svelte"));
    const root = parse(render(host.default, { props: { id: "nope:Missing" } }).body);

    expect(root.querySelector("i.fb").textContent).toBe("fallback");

    // a known id never shows the fallback
    await registry.preloadViews(["tst:Badge"]);
    const known = parse(render(host.default, { props: { id: "tst:Badge", text: "t" } }).body);

    expect(known.querySelector("i.fb")).toBeNull();
  });

  test("goes through views.wrap of the pano context when it is set", async () => {
    await registry.preloadViews(["tst:Badge"]);
    const calls = [];
    setPanoContext({
      views: {
        ...getPanoContext().context.views,
        wrap: (name, component, source) => {
          calls.push([name, source]);
          return component;
        },
      },
    });

    renderBlock({ id: "tst:Badge", text: "w" });

    expect(calls).toEqual([["tst:Badge", "default"]]);
  });
});

describe("PluginSlot", () => {
  const SLOT = "tst:cart-slot";

  async function renderSlot(props = {}) {
    await executeViewLoad(SLOT, serverEvent());
    return parse(render(PluginSlot, { props: { id: SLOT, ...props } }).body);
  }

  test("renders the injected views in priority order, with the slot's props", async () => {
    const root = await renderSlot({ props: { order: "o-7" } });

    expect([...root.querySelectorAll("span")].map((n) => n.className)).toEqual(["navcart", "promo"]);
    expect(root.querySelector(".navcart").getAttribute("data-order")).toBe("o-7");
    // the injected view's own load ran and reached it as data
    expect(root.querySelector(".navcart").getAttribute("data-loaded")).toBe("true");
  });

  test("filter keeps the items it accepts", async () => {
    const root = await renderSlot({ filter: (item) => item.id === "promo" });

    expect([...root.querySelectorAll("span")].map((n) => n.className)).toEqual(["promo"]);
  });

  test("an empty or unknown slot renders nothing", async () => {
    pageState.current = { data: {}, url: new URL("http://localhost/"), params: {} };

    expect(parse(render(PluginSlot, { props: { id: "tst:empty" } }).body).querySelectorAll("*").length).toBe(0);
  });

  test("a claimed injection is absent from its slot and its load never runs; claims:false keeps it", async () => {
    // the theme places tst:NavCart itself (the scan found a literal id)
    registry.setThemeMeta({ claims: ["tst:NavCart"] });

    const claimed = await renderSlot();

    expect(claimed.querySelector(".navcart")).toBeNull();
    expect(claimed.querySelector(".promo")).not.toBeNull();
    expect(globalThis.__engineWiringLoads).toBe(0);

    // an explicit false keeps the automatic copy
    registry.setThemeConfig({ claims: { "tst:NavCart": false } });
    registry.setThemeMeta({ claims: ["tst:NavCart"] });

    const kept = await renderSlot();

    expect(kept.querySelector(".navcart")).not.toBeNull();
    expect(globalThis.__engineWiringLoads).toBe(1);
  });

  test("an overridden but unclaimed injection needs nothing: the slot renders the override", async () => {
    registry.setThemeConfig({
      views: {
        "tst:Promo": override("ChildOverride"),
      },
    });
    await registry.preloadViews(["tst:Promo"]);

    const root = await renderSlot();

    expect(root.querySelector(".promo")).toBeNull();
    expect(root.querySelector(".child-override")).not.toBeNull();
  });
});

describe("the SDK exports both components", () => {
  test("components/theme.js exports PluginBlock and PluginSlot from the pano context", () => {
    const source = readFileSync(join(import.meta.dir, "..", "..", "..", "..", "sdk", "src", "components", "theme.js"), "utf-8");

    expect(source).toContain("export const PluginBlock = components.PluginBlock;");
    expect(source).toContain("export const PluginSlot = components.PluginSlot;");
  });
});

// ---------------------------------------------------------------------------
// PluginBlock in the browser (client build, happy-dom): the load after mount
// ---------------------------------------------------------------------------

describe("PluginBlock in the browser", () => {
  const dom = new Window();
  const DOM_GLOBALS = [
    "window", "document", "navigator", "Node", "Element", "HTMLElement", "HTMLTemplateElement", "HTMLInputElement",
    "HTMLSelectElement", "HTMLTextAreaElement", "HTMLFormElement", "HTMLImageElement", "HTMLIFrameElement",
    "HTMLMediaElement", "ShadowRoot", "Text", "Comment", "DocumentFragment", "Event", "CustomEvent", "MouseEvent",
    "KeyboardEvent", "InputEvent", "MutationObserver", "getComputedStyle", "requestAnimationFrame",
    "cancelAnimationFrame", "customElements",
  ];
  const saved = new Map();
  let clientSvelte;
  let ClientBlock;
  let clientGrid;

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
    ClientBlock = (await import(emit(realPath("lib/components/PluginBlock.svelte"), "client"))).default;
    clientGrid = await import(emit(fixturePath("Grid.svelte"), "client"));
  });

  afterAll(() => {
    for (const key of DOM_GLOBALS) {
      const was = saved.get(key);
      if (was) Object.defineProperty(globalThis, key, was);
      else delete globalThis[key];
    }
  });

  const registerClientGrid = () =>
    registry.registerViews([viewDef("tst:Grid", "Grid", { block: true, component: async () => clientGrid })]);

  async function mountBlock(props, data = {}) {
    globalThis.__engineWiringClientPage = {
      data,
      url: new URL("http://localhost/"),
      params: {},
      route: { id: "/" },
    };

    const target = dom.document.createElement("div");
    dom.document.body.appendChild(target);

    const instance = clientSvelte.mount(ClientBlock, { target, props });
    clientSvelte.flushSync();
    // the load runs in an async effect: give it a few turns
    for (let i = 0; i < 5; i++) {
      await new Promise((done) => setTimeout(done, 0));
      clientSvelte.flushSync();
    }

    return { target, instance };
  }

  test("the key is missing: the view's load runs once after mount with the literal props, and the data shows up", async () => {
    registerClientGrid();
    await registry.preloadViews(["tst:Grid"]);

    const { target, instance } = await mountBlock({ id: "tst:Grid", limit: 3 });

    expect(globalThis.__engineWiringGridLoads).toBe(1);
    expect(target.querySelectorAll("li").length).toBe(3);
    expect(target.querySelector(".grid").getAttribute("data-limit")).toBe("3");

    clientSvelte.unmount(instance);
  });

  test("the key is there: no load in the browser, the page data is used", async () => {
    registerClientGrid();
    await registry.preloadViews(["tst:Grid"]);

    const { target, instance } = await mountBlock(
      { id: "tst:Grid", limit: 2 },
      { 'block:tst:Grid#{"limit":2}': { items: ["a", "b"] } },
    );

    expect(globalThis.__engineWiringGridLoads).toBe(0);
    expect([...target.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["a", "b"]);

    clientSvelte.unmount(instance);
  });

  test("a view that was not preloaded is resolved after mount", async () => {
    registerClientGrid();

    const { target, instance } = await mountBlock({ id: "tst:Grid", limit: 1 }, { 'block:tst:Grid#{"limit":1}': { items: ["z"] } });

    expect(target.querySelector(".grid")).not.toBeNull();
    expect([...target.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["z"]);

    clientSvelte.unmount(instance);
  });

  test("a view that is not a block is rendered but its load is not called in the browser (CX-03)", async () => {
    registry.registerViews([viewDef("tst:Grid", "Grid", { component: async () => clientGrid })]);
    await registry.preloadViews(["tst:Grid"]);

    expect(registry.describeView("tst:Grid").block).toBe(false);

    const { target, instance } = await mountBlock({ id: "tst:Grid", limit: 3 });

    expect(globalThis.__engineWiringGridLoads).toBe(0);
    expect(target.querySelector(".grid")).not.toBeNull();
    expect(target.querySelectorAll("li").length).toBe(0);

    clientSvelte.unmount(instance);
  });

  test("an unknown id stays empty and loads nothing", async () => {
    const { target, instance } = await mountBlock({ id: "nope:Missing" });

    expect(target.querySelectorAll("*").length).toBe(0);
    expect(globalThis.__engineWiringGridLoads).toBe(0);

    clientSvelte.unmount(instance);
  });
});

// ---------------------------------------------------------------------------
// AppLayoutLogics: the pano context and the theme setup
// ---------------------------------------------------------------------------

describe("AppLayoutLogics wiring", () => {
  const logicsFile = join(import.meta.dir, "..", "ui-logics", "layout-logics", "AppLayoutLogics.js");

  /** names that must be real objects, not call-me stubs */
  const VALUES = {
    languageStuff: () => ({ init: async () => "lang", activateLanguage() {} }),
    avatarVersion: () => writable(null),
    initialized: () => writable(true),
    _: () => writable((key) => key),
  };

  globalThis.__engineWiringLogics = {
    stubs(name) {
      if (name in VALUES) return VALUES[name]();
      const fn = async () => ({});
      fn.stubName = name;
      return fn;
    },
    destroyers: [],
    contexts: new Map(),
    bound: [],
    createThemeHost: Object.assign(() => ({}), { stubName: "createThemeHost" }),
    themeHostFactory: Object.assign(() => ({}), { stubName: "themeHostFactory" }),
  };
  const shared = globalThis.__engineWiringLogics;

  /**
   * AppLayoutLogics.js with every import replaced by a stub except the registry, the route config, the plugin API,
   * the SDK context and the stores, which stay real. `browser` is a constant of the build.
   */
  function buildLogics({ browser }) {
    const keep = new Map([
      ["$pano/registry/index.js", join(pkgSrc, "registry", "index.js")],
      ["$pano/registry/routes.js", join(pkgSrc, "registry", "routes.js")],
      ["$pano/lib/PluginAPI", PLUGIN_API_SPEC],
      ["@panomc/sdk/internal", Bun.resolveSync("@panomc/sdk/internal", pkgSrc)],
      ["svelte/store", "svelte/store"],
      ["$app/stores", "$app/stores"],
      ["$app/paths", "$app/paths"],
      ["@sveltejs/kit", "@sveltejs/kit"],
      ["$app/navigation", "$app/navigation"],
    ]);
    const declare = (what, from) => {
      const lines = [];
      const text = what.trim();
      const star = text.match(/\*\s+as\s+(\w+)/);
      const named = text.match(/\{([\s\S]*)\}/);
      const first = text.replace(/\{[\s\S]*\}/, "").replace(/\*\s+as\s+\w+/, "").replace(/,/g, "").trim();
      if (first) lines.push(`const ${first} = __s.stubs(${JSON.stringify(first)});`);
      if (star) lines.push(`const ${star[1]} = __s.stubs(${JSON.stringify(star[1])});`);
      if (named) {
        for (const part of named[1].split(",")) {
          const name = part.trim().split(/\s+as\s+/).pop();
          if (name) lines.push(`const ${name} = __s.stubs(${JSON.stringify(name)});`);
        }
      }
      if (from === "svelte") {
        return [
          "const onDestroy = (fn) => __s.destroyers.push(fn);",
          "const onMount = () => {};",
          "const setContext = (key, value) => __s.contexts.set(key, value);",
        ].join("\n");
      }
      if (from === "$pano/lib/controllerHost") {
        return [
          "const createThemeHost = __s.createThemeHost;",
          "const themeHostFactory = __s.themeHostFactory;",
          "const bindControllerSession = (session) => { __s.bound.push(session); return () => {}; };",
        ].join("\n");
      }
      if (from === "$app/environment") return `const browser = ${browser}; const dev = false;`;
      return lines.join("\n");
    };

    let code = readFileSync(logicsFile, "utf-8");
    code = code.replace(/import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];?/g, (whole, what, from) => {
      if (keep.has(from)) return `import ${what} from ${JSON.stringify(keep.get(from))};`;
      return declare(what, from);
    });
    // side-effect-only imports (none today) and the shared handle
    code = `const __s = globalThis.__engineWiringLogics;\n${code}`;

    const out = join(workDir, `logics${counter++}.mjs`);
    writeFileSync(out, code);
    return import(out);
  }

  const processEvent = () => ({
    data: {
      user: null,
      csrfToken: "t",
      siteInfo: { locale: "en", themeSettings: {} },
      apiUrlEnv: null,
      panoWebsiteUrlEnv: null,
      avatarVersionDate: "v=1",
    },
    parent: async () => ({}),
    url: new URL("http://localhost/"),
  });

  const hostFactory = () => globalThis.__PANO_CONTROLLERS__?.hostFactory;
  const pins = () => globalThis.__PANO_CONTROLLERS__?.pins;

  beforeEach(() => {
    shared.destroyers.length = 0;
    shared.contexts.clear();
    shared.bound.length = 0;
    globalThis.__PANO_CONTROLLERS__ = undefined;
  });

  test("the source puts views, routes and both components into the pano context and keeps the old keys", () => {
    const source = readFileSync(logicsFile, "utf-8");

    expect(source).toMatch(/views:\s*{\s*getOverride,\s*getDefault,\s*has:\s*hasView,\s*wrap:\s*wrapView,\s*wrapInjected:\s*wrapInjectedView,?\s*}/);
    expect(source).toMatch(/routes:\s*{\s*resolve:\s*route,?\s*}/);
    expect(source).toContain("PluginBlock,");
    expect(source).toContain("PluginSlot,");
    // the old context components are all still there
    for (const name of ["Date", "Pagination", "NoContent", "PageActions", "PageTitle", "PlayerHead", "Toast", "Sidebar", "ViewComponent", "Hook"]) {
      expect(source).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  test("processLoad: views, routes and components land in the pano context; setup is done once", async () => {
    registry.setThemeConfig({ routes: { rename: { "/store": "/shop" } }, controllers: { "tst/cart": 2 } });

    const logics = await buildLogics({ browser: false });
    await logics.processLoad(processEvent());

    const { context } = getPanoContext();

    expect(context.views.getOverride).toBe(registry.getOverride);
    expect(context.views.getDefault).toBe(registry.getDefault);
    expect(context.views.has).toBe(registry.hasView);
    // wrap is the identity for now
    const Component = () => {};
    expect(context.views.wrap("tst:Home", Component, "default")).toBe(Component);
    expect(context.routes.resolve).toBe(registry.route);
    expect(context.routes.resolve("/store")).toBe("/shop");
    expect(context.routes.resolve("/other")).toBe("/other");
    expect(context.components.PluginBlock.stubName).toBe("PluginBlock");
    expect(context.components.PluginSlot.stubName).toBe("PluginSlot");
    // the old keys survive
    expect(context.components.Hook.stubName).toBe("Hook");
    expect(context.components.Date).toBeDefined();
    expect(context.utils.api).toBeDefined();

    // The registry hands the bare request event to the factory, so the engine registers themeHostFactory (which
    // wraps it for createThemeHost), not createThemeHost itself.
    expect(hostFactory()).toBe(shared.themeHostFactory);
    expect(pins()).toEqual({ "tst/cart": 2 });

    // a second load (a navigation) does not reset the host factory again
    const host = {};
    globalThis.__PANO_CONTROLLERS__.browserHost = host;
    await logics.processLoad(processEvent());
    expect(globalThis.__PANO_CONTROLLERS__.browserHost).toBe(host);
  });

  test("a theme without the virtual module gets an empty theme meta", async () => {
    registry.setThemeMeta({ refs: { x: [{ id: "a:B" }] }, claims: ["a:B"] });
    registry.setThemeConfig({});

    const logics = await buildLogics({ browser: false });
    await logics.processLoad(processEvent());

    expect(registry.getThemeMeta()).toEqual({ refs: {}, claims: [], homePages: {} });
  });

  test("virtual:pano-theme-meta, when it resolves, becomes the theme meta", async () => {
    mock.module("virtual:pano-theme-meta", () => ({
      default: { refs: { "tst:Home": [{ id: "tst:Grid", props: { limit: 4 } }] }, claims: ["tst:NavCart"], homePages: {} },
    }));

    registry.setThemeConfig({});
    const logics = await buildLogics({ browser: false });
    await logics.processLoad(processEvent());

    expect(registry.getThemeMeta().refs).toEqual({ "tst:Home": [{ id: "tst:Grid", props: { limit: 4 } }] });
    expect(registry.getClaims().has("tst:NavCart")).toBe(true);
  });

  test("init binds the controller session in the browser only", async () => {
    registry.setThemeConfig({});
    const data = (await (await buildLogics({ browser: false })).processLoad(processEvent()));

    const server = await buildLogics({ browser: false });
    server.init(data);
    expect(shared.bound.length).toBe(0);

    const client = await buildLogics({ browser: true });
    const had = { window: globalThis.window, document: globalThis.document };
    globalThis.document = { visibilityState: "hidden", addEventListener() {}, removeEventListener() {} };
    globalThis.window = { setTimeout, clearTimeout };
    let result;
    try {
      result = client.init(data);
    } finally {
      for (const [key, value] of Object.entries(had)) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
    }

    expect(shared.bound.length).toBe(1);
    // the very session store the layout hands to its children
    expect(shared.bound[0]).toBe(result.session);
    expect(shared.contexts.get("session")).toBe(result.session);
    // and it is released with the layout
    expect(shared.destroyers.length).toBeGreaterThan(0);
  });
});
