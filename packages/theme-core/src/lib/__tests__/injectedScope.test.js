import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Window } from "happy-dom";
import { readable, writable } from "svelte/store";
import postcss from "postcss";

import { findSvelte } from "./svelteSsr.helper.js";

// FX-02: the fallback scope of injected views (doc 03 section 4.4, call sites: nav / sidebar / hook views) and the
// `legacy` sheet for plugins that are not on the new model.
//
// The real `Hook.svelte`, `ViewComponent.svelte` and `FallbackScope.svelte` are compiled with the Svelte compiler and
// rendered on the server (the SvelteKit aliases and the plugin API are stubs); happy-dom parses the markup.

const pageStore = {
  subscribe(run) {
    run({ data: {}, url: new URL("http://localhost/"), params: {}, route: { id: "/" }, error: null });
    return () => {};
  },
};

mock.module("@sveltejs/kit", () => ({
  redirect: () => {},
  error: (status, message) => Object.assign(new Error(`HTTP ${status} ${message ?? ""}`), { status }),
}));
mock.module("$app/paths", () => ({ base: "" }));
mock.module("$app/environment", () => ({ browser: false, dev: false }));
mock.module("$app/navigation", () => ({ goto: async () => {}, invalidate: async () => {}, invalidateAll: async () => {} }));
mock.module("$app/stores", () => ({ page: pageStore, navigating: writable(null) }));

const registry = await import("../../registry/index.js");
const { setPanoContext, getPanoContext } = await import("../../../../sdk/src/internal/index.js");
const fallback = await import("../fallbackStyles.js");

const { STYLES_CONTEXT, createFallbackStyles, createViewWrapper } = fallback;

const HASH = "9f2c1a7e";

/** The styles of the fixture plugin `tst`, which is on the new model (it has a fallback sheet). */
const TABLE = {
  tst: {
    id: "pano-plugin-tst",
    ns: "tst",
    styles: { fallback: "client/fallback.css", hash: HASH },
    roots: { Promo: ["span"] },
  },
};

const svelteDir = findSvelte();
const pkgSrc = join(import.meta.dir, "..", "..");
const suite = svelteDir !== null ? describe : describe.skip;

const FIXTURES = {
  // a plugin that is not on the new model: a plain component with Bootstrap classes
  "LegacyBanner.svelte": `<div class="alert alert-info">legacy banner</div>`,

  // a legacy component that injects another legacy component of its own through <ViewComponent>
  "LegacyOuter.svelte": `<div class="outer"><ViewComponent component={inner} /></div>
<script>
  import ViewComponent from "$pano/lib/components/ViewComponent.svelte";

  let { inner } = $props();
</script>`,

  // a named view of a plugin on the new model
  "Promo.svelte": `<span class="promo">promo</span>`,

  "Host.svelte": `<Hook name="cookie" />
<script>
  import Hook from "$pano/lib/components/Hook.svelte";
</script>`,

  "ViewHost.svelte": `<ViewComponent {component} />
<script>
  import ViewComponent from "$pano/lib/components/ViewComponent.svelte";

  let { component } = $props();
</script>`,
};

const PLUGIN_API_FILE = join(import.meta.dir, "..", "PluginAPI.js");
const PLUGIN_API_STUB = `
import { readable } from "svelte/store";
export const panoApiClient = { ui: { hook: { get: (name) => readable(globalThis.__fx02Hooks?.[name] ?? []) } } };
`;

let workDir;
let compiler;
let render;
let counter = 0;
const emitted = new Map();
const modules = {};

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

function stubFile(name, source) {
  const file = join(workDir, `stub-${name}.mjs`);

  if (!existsSync(file)) writeFileSync(file, source);

  return file;
}

function target_(spec, from) {
  if (spec === "svelte" || spec.startsWith("svelte/")) return spec;
  if (spec.startsWith("@panomc/")) return Bun.resolveSync(spec, pkgSrc);

  let base = null;

  if (spec.startsWith("$pano/")) base = join(pkgSrc, spec.slice("$pano/".length));
  else if (spec.startsWith(".")) base = resolve(from, spec);

  if (!base) return spec; // $app/*, @sveltejs/kit: mocked

  const found = firstExisting(base);

  if (!found) throw new Error(`cannot resolve ${spec} from ${from}`);

  if (found.endsWith(".svelte")) return emit(found);
  if (found === PLUGIN_API_FILE) return stubFile("plugin-api", PLUGIN_API_STUB);

  return found;
}

/** Compiles a .svelte file (and, recursively, the .svelte files it imports) and returns the path of the module. */
function emit(file) {
  if (emitted.has(file)) return emitted.get(file);

  const out = join(workDir, `m${counter++}.mjs`);

  emitted.set(file, out);

  const { js } = compiler.compile(readFileSync(file, "utf-8"), { generate: "server", filename: file.split("/").pop() });
  const from = dirname(file);
  const code = js.code.replace(/(\bfrom\s*|\bimport\s*)(["'])([^"']+)\2/g, (whole, lead, _quote, spec) => {
    const target = target_(spec, from);

    return target === spec ? whole : `${lead}${JSON.stringify(target)}`;
  });

  writeFileSync(out, code);

  return out;
}

let FallbackScope;

beforeAll(async () => {
  if (!svelteDir) return;

  const scratch = join(pkgSrc, "..", "node_modules");

  mkdirSync(scratch, { recursive: true });
  workDir = mkdtempSync(join(scratch, ".fx02-"));
  mkdirSync(join(workDir, "fixtures"));
  compiler = await import(join(svelteDir, "src", "compiler", "index.js"));
  ({ render } = await import(join(svelteDir, "src", "server", "index.js")));

  for (const [name, source] of Object.entries(FIXTURES)) {
    const file = join(workDir, "fixtures", name);

    writeFileSync(file, source);
    modules[name.replace(".svelte", "")] = await import(emit(file));
  }

  FallbackScope = (await import(emit(join(pkgSrc, "lib/components/FallbackScope.svelte")))).default;
});

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });

  registry.resetRegistryForTests();
});

afterEach(() => {
  delete getPanoContext().context.views;
  delete globalThis.__fx02Hooks;
});

/**
 * Installs a theme (`provides`) and the pano context the way `processLoad` does; `injected: false` leaves
 * `wrapInjected` out, which is how a context from before this change looks.
 */
async function installTheme({ provides = { bootstrap: false, fontawesome: false }, injected = true } = {}) {
  registry.resetRegistryForTests();
  registry.registerViews([
    {
      name: "tst:Promo",
      pluginId: "pano-plugin-tst",
      contract: 1,
      kind: "component",
      component: async () => modules.Promo,
    },
  ]);
  registry.setThemeConfig({ provides });
  await registry.preloadViews(["tst:Promo"]);

  const wrapper = createViewWrapper({
    FallbackScope,
    getTable: () => TABLE,
    getProvides: registry.getThemeProvides,
  });

  setPanoContext({
    views: {
      getOverride: registry.getOverride,
      getDefault: registry.getDefault,
      has: registry.hasView,
      wrap: wrapper.wrap,
      ...(injected ? { wrapInjected: wrapper.wrapInjected } : {}),
    },
  });

  return wrapper;
}

/** Renders a root component with a fresh stylesheet store in context; returns the DOM and the store's keys. */
function renderWith(Component, props = {}) {
  const styles = createFallbackStyles({ browser: false });
  const { body } = render(Component, { props, context: new Map([[STYLES_CONTEXT, styles]]) });
  const doc = new Window().document;

  doc.body.innerHTML = body;

  return { body, root: doc.body, keys: [...styles.keys] };
}

const hook = (component) => {
  globalThis.__fx02Hooks = { cookie: [{ component }] };
};

suite("injected views in a theme without Bootstrap", () => {
  test("a legacy hook gets one legacy scope and asks for the legacy sheet and the icon sheet", async () => {
    await installTheme();
    hook(modules.LegacyBanner);

    const { root, keys } = renderWith(modules.Host.default);
    const scopes = root.querySelectorAll("div.pano-fb[data-pano-fb='legacy']");

    expect(root.querySelectorAll(".pano-fb").length).toBe(1);
    expect(scopes.length).toBe(1);
    expect(scopes[0].getAttribute("style")).toBe("display: contents");
    expect(scopes[0].querySelector(":scope > .alert.alert-info").textContent).toBe("legacy banner");
    expect(keys).toContain("legacy");
    expect(keys).toContain("icons");
    expect(keys.sort()).toEqual(["icons", "legacy"]);
  });

  test("with Font Awesome provided the icon sheet is not requested", async () => {
    await installTheme({ provides: { bootstrap: false, fontawesome: true } });
    hook(modules.LegacyBanner);

    const { root, keys } = renderWith(modules.Host.default);

    expect(root.querySelectorAll(".pano-fb[data-pano-fb='legacy']").length).toBe(1);
    expect(keys).toEqual(["legacy"]);
  });

  test("ViewComponent wraps a legacy component the same way", async () => {
    await installTheme();

    const { root, keys } = renderWith(modules.ViewHost.default, { component: modules.LegacyBanner });

    expect(root.querySelectorAll("div.pano-fb[data-pano-fb='legacy'] > .alert").length).toBe(1);
    expect(keys.sort()).toEqual(["icons", "legacy"]);
  });

  test("a legacy component inside a legacy scope is not wrapped twice", async () => {
    await installTheme();
    // the hook's component is a module whose default takes the inner legacy module as a prop
    globalThis.__fx02Hooks = {
      cookie: [{ component: { default: (anchor, props) => modules.LegacyOuter.default(anchor, { ...props, inner: modules.LegacyBanner }) } }],
    };

    const { root } = renderWith(modules.Host.default);

    expect(root.querySelectorAll(".pano-fb").length).toBe(1);
    expect(root.querySelectorAll(".pano-fb > .outer > .alert").length).toBe(1);
  });

  test("a named injected view of a plugin with styles.fallback gets that plugin's scope, not the legacy one", async () => {
    await installTheme();

    const module = await registry.loadForInjection("tst:Promo");

    expect(module.__panoView).toBe("tst:Promo");
    expect(module.__panoSource).toBe("default");
    expect(module.default).toBe(modules.Promo.default);

    hook(module);

    const { root, keys } = renderWith(modules.Host.default);
    const scopes = root.querySelectorAll(".pano-fb");

    expect(scopes.length).toBe(1);
    expect(scopes[0].getAttribute("data-pano-fb")).toBe("tst");
    expect(scopes[0].querySelector(":scope > span.promo").textContent).toBe("promo");
    expect(keys).toEqual(["tst"]);
  });

  test("loadForInjection hands out a copy: the registry's own module is not marked", async () => {
    await installTheme();

    const module = await registry.loadForInjection("tst:Promo");
    const again = await registry.resolveViewModule("tst:Promo");

    expect(module).not.toBe(again.module);
    expect(again.module.__panoView).toBeUndefined();
    expect(await registry.loadForInjection("tst:Nope")).toBeNull();
  });

  test("a context without wrapInjected renders the component as before", async () => {
    await installTheme({ injected: false });
    hook(modules.LegacyBanner);

    const { root, keys } = renderWith(modules.Host.default);

    expect(root.querySelectorAll(".pano-fb").length).toBe(0);
    expect(root.querySelectorAll(".alert").length).toBe(1);
    expect(keys).toEqual([]);
  });
});

suite("injected views in a Bootstrap theme", () => {
  test("the HTML is identical to the one without wrapInjected, and no sheet is asked for", async () => {
    await installTheme({ provides: {}, injected: false });
    hook(modules.LegacyBanner);

    const before = renderWith(modules.Host.default);

    await installTheme({ provides: {} });
    hook(modules.LegacyBanner);

    const legacy = renderWith(modules.Host.default);

    expect(legacy.body).toBe(before.body);
    expect(legacy.keys).toEqual([]);
    expect(legacy.body).not.toContain("pano-fb");

    hook(await registry.loadForInjection("tst:Promo"));

    const named = renderWith(modules.Host.default);

    expect(named.body).not.toContain("pano-fb");
    expect(named.keys).toEqual([]);

    const view = renderWith(modules.ViewHost.default, { component: modules.LegacyBanner });

    expect(view.body).not.toContain("pano-fb");
    expect(view.keys).toEqual([]);
  });
});

describe("wrapInjected, without a render", () => {
  const Fake = (_anchor, payload) => ({ scope: payload });
  const Component = () => {};

  function setup({ provides = { bootstrap: false, fontawesome: true }, inside } = {}) {
    const store = createFallbackStyles({ browser: false });
    const context = { [STYLES_CONTEXT]: store, "pano:fb": inside };
    const wrapper = createViewWrapper({
      FallbackScope: Fake,
      getTable: () => TABLE,
      getProvides: () => provides,
      readScope: (key) => context[key],
    });

    return { ...wrapper, store };
  }

  test("a legacy module in a Bootstrap-free theme: the legacy scope and the legacy key", () => {
    const { wrapInjected, store } = setup();
    const wrapped = wrapInjected({ default: Component });

    expect(wrapped).not.toBe(Component);
    expect(wrapped.scope).toEqual({ mode: "fallback", ns: "legacy" });
    expect(wrapped("anchor", { a: 1 }).scope).toEqual({ Component, ns: "legacy", mode: "fallback", props: { a: 1 } });
    expect([...store.keys]).toEqual(["legacy"]);
  });

  test("the icon sheet is added when the theme provides no Font Awesome", () => {
    const { wrapInjected, store } = setup({ provides: { bootstrap: false, fontawesome: false } });

    wrapInjected({ default: Component });

    expect([...store.keys].sort()).toEqual(["icons", "legacy"]);
  });

  test("a bare component works as well as a module", () => {
    const { wrapInjected } = setup();

    expect(wrapInjected(Component).scope).toEqual({ mode: "fallback", ns: "legacy" });
  });

  test("Bootstrap provided: the component itself, no key", () => {
    const { wrapInjected, store } = setup({ provides: { bootstrap: true, fontawesome: true } });

    expect(wrapInjected({ default: Component })).toBe(Component);
    expect(wrapInjected(Component)).toBe(Component);
    expect([...store.keys]).toEqual([]);
  });

  test("already inside the legacy scope: the component itself; inside another plugin's scope: a legacy scope again", () => {
    expect(setup({ inside: "legacy" }).wrapInjected({ default: Component })).toBe(Component);
    expect(setup({ inside: "tst" }).wrapInjected({ default: Component }).scope).toEqual({ mode: "fallback", ns: "legacy" });
  });

  test("a module that names its view goes through wrap, with its source", () => {
    const { wrapInjected, store } = setup();
    const wrapped = wrapInjected({ default: Component, __panoView: "tst:Promo", __panoSource: "default" });

    expect(wrapped.scope).toEqual({ mode: "fallback", ns: "tst" });
    expect([...store.keys]).toEqual(["tst"]);

    // an override outside every scope is left alone; inside a scope it gets a stop scope
    expect(setup().wrapInjected({ default: Component, __panoView: "tst:Promo", __panoSource: "override" })).toBe(Component);
    expect(setup({ inside: "tst" }).wrapInjected({ default: Component, __panoView: "tst:Promo", __panoSource: "override" }).scope).toEqual({
      mode: "stop",
      ns: "tst",
    });
  });
});

describe("the legacy sheet", () => {
  const sheet = readFileSync(join(import.meta.dir, "..", "..", "..", "assets", "css", "pano-fallback-legacy.css"), "utf-8");
  const root = postcss.parse(sheet);

  test("holds the Bootstrap classes an old plugin uses", () => {
    for (const cls of [".btn-primary", ".alert", ".fixed-bottom", ".modal"]) expect(sheet).toContain(cls);
    expect(sheet).toContain('.pano-fb[data-pano-fb="legacy"]');
  });

  test("has no rule outside @layer pano-fallback.*, except the body-level block", () => {
    const outside = [];

    root.each((node) => {
      if (node.type === "comment") return;
      if (node.type === "atrule" && node.name === "layer") {
        if (!node.nodes || node.params.startsWith("pano-fallback.")) return; // the layer statement / a fallback layer
        if (node.params === "pano-defaults, pano-fallback.components, pano-fallback.utilities, pano-plugin") return;
      }

      outside.push(node.type === "rule" ? node.selector : `@${node.name} ${node.params}`);
    });

    expect(outside).toEqual([]);

    // inside the layers: every rule is under @scope, or is the body-level block (Bootstrap JS appends these to <body>)
    const bodyLevel = /^(?:\.modal-backdrop|\.modal-open|\.offcanvas-backdrop|\.tooltip|\.popover|\.fade|\.show|\.bs-)/;
    const stray = [];

    root.walkAtRules("layer", (layer) => {
      if (!layer.nodes) return;

      layer.each((node) => {
        if (node.type === "atrule" && node.name === "scope") return;
        if (node.type === "atrule" && node.name === "keyframes") return;
        if (node.type === "comment") return;
        if (node.type === "rule" && node.selector.split(",").every((part) => bodyLevel.test(part.trim()))) return;
        if (node.type === "atrule" && node.name === "media") {
          const inner = [];

          node.walkRules((rule) => inner.push(rule));
          if (inner.length && inner.every((rule) => rule.selector.split(",").every((part) => bodyLevel.test(part.trim())))) return;
        }

        stray.push(node.type === "rule" ? node.selector : `@${node.name}`);
      });
    });

    expect(stray).toEqual([]);
  });

  test("is bound to the tokens", () => {
    expect(sheet).toContain("var(--pano-color-primary)");
  });
});
