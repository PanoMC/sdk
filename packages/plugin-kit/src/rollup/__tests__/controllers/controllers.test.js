import { afterAll, beforeAll, describe, expect, onTestFinished, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { getBuildContext } from "../../meta.js";
import { declaredTypeNames, validateTypesSource } from "../../types.js";
import { OUT, build, cartSource, cleanupFixtures, makeFixture, read, write } from "./fixture.js";

const GOLDEN = path.join(import.meta.dir, "golden");

/** Compares with golden/<name>; UPDATE_GOLDEN=1 rewrites it. */
function expectGolden(name, text) {
  const file = path.join(GOLDEN, name);

  if (process.env.UPDATE_GOLDEN === "1") {
    fs.mkdirSync(GOLDEN, { recursive: true });
    fs.writeFileSync(file, text);
  }

  expect(fs.existsSync(file), `${name} is missing: run with UPDATE_GOLDEN=1`).toBe(true);
  expect(text).toBe(fs.readFileSync(file, "utf8"));
}

beforeAll(() => {
  delete process.env.PANO_VIEW_IMPORTS;
});
afterAll(cleanupFixtures);

const MJS = `${OUT}/controllers/controllers.mjs`;

describe("standalone controllers.mjs", () => {
  test("is one minified module with no import, exporting controllers, createHost, create, meta", async () => {
    const root = makeFixture();

    await build(root);

    const code = read(root, MJS);
    const scan = new Bun.Transpiler({ loader: "js" }).scan(code);

    expect(scan.imports).toEqual([]);
    expect(scan.exports.sort()).toEqual(["controllers", "create", "createHost", "meta"]);
    expect(code.split("\n").length).toBeLessThanOrEqual(2);
    expect(code).not.toContain("@typedef");
    expect(code).not.toContain("sub-folders are private code");

    const mod = await import(path.join(root, MJS));

    expect(Object.keys(mod.controllers)).toEqual(["cart", "format"]);
    expect(mod.meta).toEqual({
      format: 1,
      pluginId: "pano-plugin-demo",
      namespace: "demo",
      controllers: { cart: { version: 1, scope: "app" }, format: { version: 1, scope: "instance" } },
    });
    expect(mod.createHost).toBeFunction();
  });

  test("a script imports it from an empty directory and drives a controller", () => {
    const root = makeFixture();

    return build(root).then(() => {
      const empty = fs.mkdtempSync(path.join(os.tmpdir(), "pano-kit-fixture-empty-"));

      onTestFinished(() => fs.rmSync(empty, { recursive: true, force: true }));

      fs.copyFileSync(path.join(root, MJS), path.join(empty, "controllers.mjs"));
      fs.writeFileSync(
        path.join(empty, "run.mjs"),
        `import * as demo from "./controllers.mjs";
const calls = [];
const host = demo.createHost({
  baseUrl: "https://example.com",
  messages: { "plugins.pano-plugin-demo.currency": "USD" },
  fetch: async (url) => { calls.push(url); return new Response("{}", { status: 200 }); },
});
const cart = demo.create("cart", host);
const seen = [];
const off = cart.subscribe((s) => seen.push(s.count));
await cart.actions.add({ id: 1 });
off();
const format = demo.create("format", host);
console.log(JSON.stringify({
  seen,
  keys: Object.keys(demo).sort(),
  money: await format.actions.money(1500),
  same: demo.create("cart", host) === cart,
}));
`,
      );

      const runtimes = [process.execPath, Bun.which("node")].filter(Boolean);

      for (const runtime of runtimes) {
        const result = Bun.spawnSync([runtime, "run.mjs"], { cwd: empty, stdout: "pipe", stderr: "pipe" });

        expect(result.stderr.toString(), runtime).toBe("");
        expect(JSON.parse(result.stdout.toString()), runtime).toEqual({
          seen: [0, 4],
          keys: ["controllers", "create", "createHost", "meta"],
          money: "000015 USD",
          same: true,
        });
      }
    });
  });

  test("create: app scope is one per host, instance scope is new, unknown names throw, destroy frees the slot", async () => {
    const root = makeFixture();

    await build(root);

    const mod = await import(path.join(root, MJS) + "?semantics");
    const host = mod.createHost({ baseUrl: "" });
    const other = mod.createHost({ baseUrl: "" });
    const cart = mod.create("cart", host);

    expect(mod.create("cart", host)).toBe(cart);
    expect(mod.create("cart", other)).not.toBe(cart);
    expect(mod.create("format", host)).not.toBe(mod.create("format", host));
    expect(cart.name).toBe("demo/cart");
    expect(() => mod.create("nope", host)).toThrow("controller 'demo/nope' is not in this package (available: cart, format)");

    cart.destroy();
    expect(mod.create("cart", host)).not.toBe(cart);
  });

  test("ctx.use reaches a sibling made on the same host", async () => {
    const root = makeFixture({
      "src/theme/controllers/badge.js": `import { defineController } from '@panomc/plugin-kit/controller';
export default defineController({
  name: 'badge',
  version: 1,
  actions: (c) => ({ total: () => c.use('cart').get().count }),
});
`,
    });

    await build(root);

    const mod = await import(path.join(root, MJS) + "?use");
    const host = mod.createHost({ baseUrl: "" });
    const badge = mod.create("badge", host);

    await mod.create("cart", host).actions.add({ id: 1 });
    expect(badge.actions.total()).toBe(4);
  });

  test("an unchanged second build rewrites nothing, a changed controller is picked up fresh", async () => {
    const root = makeFixture();

    await build(root);

    const files = [MJS, `${OUT}/contract/controllers.json`, `${OUT}/contract/controllers.types.js`, `${OUT}/pano-plugin.json`, "pano-plugin.lock.json"];
    const before = files.map((file) => fs.statSync(path.join(root, file)).mtimeMs);

    await new Promise((resolve) => setTimeout(resolve, 20));
    await build(root);
    expect(files.map((file) => fs.statSync(path.join(root, file)).mtimeMs)).toEqual(before);

    write(root, "src/theme/controllers/cart.js", cartSource({ state: ["status", "lines", "count", "replaceRequest", "coupon"], actions: ["add", "setQuantity", "clear", "retry", "apply"] }));
    await build(root);

    expect(JSON.parse(read(root, `${OUT}/contract/controllers.json`))["demo/cart"].state).toContain("coupon");
    expect(read(root, `${OUT}/contract/controllers.types.js`)).toContain("apply: (...args: any[]) => any");
  });
});

describe("contract files", () => {
  test("controllers.json, controllers.types.js and pano-plugin.json match the golden files", async () => {
    const root = makeFixture();

    await build(root);

    expectGolden("controllers.json", read(root, `${OUT}/contract/controllers.json`));
    expectGolden("controllers.types.js", read(root, `${OUT}/contract/controllers.types.js`));
    expectGolden("pano-plugin.json", read(root, `${OUT}/pano-plugin.json`));
    expectGolden("pano-plugin.lock.json", read(root, "pano-plugin.lock.json"));
  });

  test("pano-plugin.json collects what the other sub-plugins put on the shared build context", async () => {
    const root = makeFixture({
      [`${OUT}/contract/views.json`]: JSON.stringify({ namespace: "demo", views: { "demo:HelloPage": {}, "demo:ProductCard": {} } }),
    });
    const context = getBuildContext(root);

    context.views.ProductCard = {
      samples: ["filled", "empty"],
      controllers: { "demo/format": 1, "demo/cart": 1 },
      helpers: ["lib/sale.js"],
      roots: ["div"],
      classes: ["demo-product-card"],
      attrs: ["title"],
    };
    context.styles = { fallback: "client/fallback.css", own: "client/plugin.css", hash: "9f2c1a7e", icons: true };
    context.badges.semanticClasses = true;
    context.badges.samples = true;
    context.viewImports = "warn";

    await build(root);

    expectGolden("pano-plugin.with-views.json", read(root, `${OUT}/pano-plugin.json`));
  });

  test("a plugin without public controllers has no controllers file, key or stale output", async () => {
    const root = makeFixture();

    await build(root);
    fs.rmSync(path.join(root, "src/theme/controllers"), { recursive: true });
    await build(root);

    const index = JSON.parse(read(root, `${OUT}/pano-plugin.json`));

    expect(index.controllers).toBeUndefined();
    expect(index.badges.controllers).toBe(false);
    expect(fs.existsSync(path.join(root, MJS))).toBe(false);
    expect(fs.existsSync(path.join(root, `${OUT}/contract/controllers.json`))).toBe(false);
    expect(fs.existsSync(path.join(root, `${OUT}/contract/controllers.types.js`))).toBe(false);
  });

  test("the generated types module type-checks and keeps an author's typedef", async () => {
    const root = makeFixture();

    await build(root);

    const dir = path.join(root, OUT, "contract");
    const check = path.join(dir, "check.js");

    fs.writeFileSync(
      check,
      `/** @type {import('./controllers.types.js').Controllers['demo/cart']} */
export let cart = /** @type {any} */ (null);
export const count = cart.get().count + 1;
cart.actions.add(1);
/** @type {import('./controllers.types.js').CartState} */
export const state = { status: 'idle', lines: [], count: 1 };
// @ts-expect-error status is declared by the author as 'idle' | 'busy'
export const bad = /** @type {import('./controllers.types.js').CartState} */ ({ status: 'nope', lines: [], count: 1 });
/** @type {import('./controllers.types.js').Controllers['demo/format']} */
export let format = /** @type {any} */ (null);
format.actions.money(1);
`,
    );

    const program = ts.createProgram([check], {
      allowJs: true,
      checkJs: true,
      noEmit: true,
      strict: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
    });
    const diagnostics = ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));

    expect(diagnostics).toEqual([]);
  });
});

describe("types.js validation", () => {
  test("accepts comments and export {} only", () => {
    expect(() => validateTypesSource("")).not.toThrow();
    expect(() => validateTypesSource("/** @typedef {number} A */\n// note\nexport {};\n")).not.toThrow();
    expect(() => validateTypesSource("/** @typedef {import('x').Y} A */\nexport {}\n")).not.toThrow();
  });

  test("names the first statement and its line", () => {
    expect(() => validateTypesSource("/** @typedef {number} A */\n\nexport const x = 1;\n", "src/theme/controllers/types.js")).toThrow(
      "src/theme/controllers/types.js:3 has code (export const x = 1;) — types.js may hold only @typedef comments and export {}",
    );
    expect(() => validateTypesSource("import x from 'y';\nexport {};")).toThrow("types.js:1 has code");
  });

  test("a code statement in types.js fails the build", async () => {
    const root = makeFixture({ "src/theme/controllers/types.js": "/** @typedef {number} A */\nexport const x = 1;\n" });

    await expect(build(root)).rejects.toThrow("src/theme/controllers/types.js:2 has code (export const x = 1;)");
  });

  test("declaredTypeNames reads nested braces and callbacks", () => {
    const text = `/**
 * @typedef {{ a: { b: number } }} Deep
 * @typedef {Object} Plain
 * @callback Handler
 */
/** @typedef Bare */`;

    expect([...declaredTypeNames(text)].sort()).toEqual(["Bare", "Deep", "Handler", "Plain"]);
  });

  test("without types.js the typedefs are all generated", async () => {
    const root = makeFixture({ "src/theme/controllers/types.js": null });

    await build(root);

    const text = read(root, `${OUT}/contract/controllers.types.js`);

    expect(text).toContain("@typedef {{ status: any, lines: any, count: any, replaceRequest: any }} CartState");
    expect(text.trimEnd().endsWith("export {};")).toBe(true);
    expect(text.match(/^export \{\};$/gm)).toHaveLength(1);
  });
});

describe("build rules of the standalone build", () => {
  test("a framework import fails with the import chain", async () => {
    const root = makeFixture({
      "src/theme/controllers/cart.js": cartSource({ extra: "import { session } from '../stores/session.js';" }),
      "src/theme/stores/session.js": "import { writable } from 'svelte/store';\nexport const session = writable(null);\n",
    });

    await expect(build(root)).rejects.toThrow(
      "controllers/cart.js -> stores/session.js imports svelte/store — controllers are framework-free; use host.session()",
    );
  });

  test("a package that is not installed fails with the fix", async () => {
    const root = makeFixture({ "src/theme/controllers/cart.js": cartSource({ extra: "import 'not-installed';" }) });

    await expect(build(root)).rejects.toThrow("controllers/cart.js imports 'not-installed', which cannot be resolved");
  });

  test("a default export that is not defineController fails", async () => {
    const root = makeFixture({ "src/theme/controllers/oops.js": "export default { name: 'oops' };\n" });

    await expect(build(root)).rejects.toThrow("controllers/oops.js: the default export must be defineController");
  });

  test("two files with one controller name fail", async () => {
    const root = makeFixture({ "src/theme/controllers/cart2.js": cartSource() });

    await expect(build(root)).rejects.toThrow("the controller name 'cart' is already used by another file");
  });

  test("a controller that touches the network while enumerating is named", async () => {
    const root = makeFixture({
      "src/theme/controllers/cart.js": `import { defineController } from '@panomc/plugin-kit/controller';
export default defineController({ name: 'cart', version: 1, state: () => ({ a: window.location.href }) });
`,
    });

    await expect(build(root)).rejects.toThrow("demo/cart: cannot read its keys on the null host");
  });
});

describe("controllers lock section", () => {
  const LOCKED = (root) => JSON.parse(read(root, "pano-plugin.lock.json")).controllers;

  test("the first build writes it, added keys update it silently", async () => {
    const root = makeFixture();

    await build(root);
    expect(LOCKED(root)["demo/cart"].actions).toEqual(["add", "setQuantity", "clear", "retry"]);

    write(root, "src/theme/controllers/cart.js", cartSource({ actions: ["add", "setQuantity", "clear", "retry", "apply"] }));
    await build(root);
    expect(LOCKED(root)["demo/cart"].actions).toContain("apply");
  });

  test("removing an action without a new version fails the build", async () => {
    const root = makeFixture();

    await build(root);
    write(root, "src/theme/controllers/cart.js", cartSource({ actions: ["add", "setQuantity", "clear"] }));

    await expect(build(root)).rejects.toThrow(
      "demo/cart: action 'retry' removed — set version: 2 in src/theme/controllers/cart.js",
    );
    expect(LOCKED(root)["demo/cart"].actions).toContain("retry");
  });

  test("removing a state key without a new version fails the build", async () => {
    const root = makeFixture();

    await build(root);
    write(root, "src/theme/controllers/cart.js", cartSource({ state: ["status", "lines", "count"] }));

    await expect(build(root)).rejects.toThrow("demo/cart: state 'replaceRequest' removed — set version: 2");
  });

  test("a raised version accepts the removal and rewrites the lock", async () => {
    const root = makeFixture();

    await build(root);
    write(root, "src/theme/controllers/cart.js", cartSource({ version: 2, actions: ["add", "setQuantity", "clear"] }));
    await build(root);

    expect(LOCKED(root)["demo/cart"]).toEqual({ version: 2, state: ["status", "lines", "count", "replaceRequest"], actions: ["add", "setQuantity", "clear"] });
  });

  test("in watch mode a removal is one warning and the lock is left alone", async () => {
    const root = makeFixture();

    await build(root);

    const lock = read(root, "pano-plugin.lock.json");
    const warnings = [];

    write(root, "src/theme/controllers/cart.js", cartSource({ actions: ["add", "setQuantity", "clear"] }));
    await build(root, { watch: true, warnings });

    expect(warnings.filter((message) => message.includes("action 'retry' removed"))).toHaveLength(1);
    expect(warnings.join("\n")).toContain("demo/cart: action 'retry' removed — set version: 2 in src/theme/controllers/cart.js");
    expect(read(root, "pano-plugin.lock.json")).toBe(lock);
    expect(JSON.parse(read(root, `${OUT}/contract/controllers.json`))["demo/cart"].actions).not.toContain("retry");
  });

  test("the lock keeps the views section written by panoViews", async () => {
    const root = makeFixture({ "pano-plugin.lock.json": JSON.stringify({ format: 1, views: { "demo:A": { contract: 1 } } }) });

    await build(root);

    const lock = JSON.parse(read(root, "pano-plugin.lock.json"));

    expect(lock.views).toEqual({ "demo:A": { contract: 1 } });
    expect(Object.keys(lock.controllers)).toEqual(["demo/cart", "demo/format"]);
  });
});
