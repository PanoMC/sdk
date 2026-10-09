import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { rollup } from "rollup";
import { createSampleController, defineController } from "../../../controller/index.js";
import { main } from "../../../../bin/pano-plugin.js";
import { getBuildContext } from "../../meta.js";
import {
  STANDARD_STATES,
  checkSamples,
  compileSamples,
  panoSamples,
  runCheckWithSamples,
  runSamples,
  samplesStub,
} from "../../samples.js";

/** @type {string[]} */
const made = [];

afterEach(() => {
  while (made.length) fs.rmSync(/** @type {string} */ (made.pop()), { recursive: true, force: true });
});

const PAGE = `<script module>
  export const view = { path: "/cart" };
</script>
<script>
  /** @type {{ lines: { id: number }[], title: string, count?: number }} */
  let { lines, title, count = 0 } = $props();
</script>
<h1>{title}</h1>
`;

const PLAIN = `<script>
  /** @type {{ label: string }} */
  let { label } = $props();
</script>
<span>{label}</span>
`;

const BLOCK = `<script module>
  export const view = { block: true };
</script>
<p>block</p>
`;

const FIXTURES = `export const lines = [{ id: 1 }, { id: 2 }];
`;

const CART_SAMPLES = `import { lines } from '../../fixtures.js';
export const notApplicable = ['loading', 'error'];
export default {
  filled: { props: { lines, title: 'Cart' }, controllers: { 'demo/cart': { count: 2 } } },
  empty: { props: { lines: [], title: 'Cart' }, session: 'guest' },
  gifted: () => ({ props: { lines: [lines[0]], title: 'Gift' }, label: 'Gift' }),
};
`;

const FULL = (title) => `export default {
  filled: { props: { label: '${title}' } },
  empty: { props: { label: '' } },
  error: { props: { label: '!' } },
  loading: { props: { label: '...' } },
};
`;

/** @param {Record<string, string>} files */
function plugin(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kit-samples-"));

  made.push(root);

  const all = { "gradle.properties": "pluginId=pano-plugin-demo\nversion=1.0.0\n", ...files };

  for (const [file, content] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }

  return root;
}

const BASE = {
  "src/theme/fixtures.js": FIXTURES,
  "src/theme/views/pages/Cart.svelte": PAGE,
  "src/theme/views/Chip.svelte": PLAIN,
};

/** Runs a rollup build of a throw-away entry with only panoSamples, as the client build would. */
async function buildWith(root, options = {}) {
  const outDir = path.join(root, "out");
  const logs = [];
  const bundle = await rollup({
    input: "\0entry",
    onwarn: (warning) => logs.push(warning.message),
    plugins: [
      { name: "entry", resolveId: (id) => (id === "\0entry" ? id : null), load: (id) => (id === "\0entry" ? "export default 1;" : null) },
      panoSamples({ root, outDir, side: "client", ...options }),
    ],
  });

  try {
    await bundle.write({ dir: path.join(outDir, "client"), format: "es" });
  } finally {
    await bundle.close();
  }

  return { outDir, logs };
}

/** Imports the written module the way the catalogue does. */
async function loadWritten(outDir) {
  const file = path.join(outDir, "samples", "samples.mjs");
  const copy = path.join(os.tmpdir(), `kit-samples-load-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`);

  fs.copyFileSync(file, copy);
  made.push(copy);

  return import(pathToFileURL(copy).href);
}

describe("samples.mjs", () => {
  test("has the shape of doc 02 section 7 and is self-contained", async () => {
    const root = plugin({
      ...BASE,
      "src/theme/views/pages/Cart.samples.js": CART_SAMPLES,
      "src/theme/views/Chip.samples.js": FULL("Chip"),
    });
    const { outDir } = await buildWith(root);
    const text = fs.readFileSync(path.join(outDir, "samples/samples.mjs"), "utf8");

    expect(text).not.toMatch(/^\s*import\b/m);

    const mod = await loadWritten(outDir);

    expect(Object.keys(mod.default)).toEqual(["Cart", "Chip"]);
    expect(Object.keys(mod.default.Cart)).toEqual(["filled", "empty", "gifted"]);
    expect(mod.default.Cart.filled).toEqual({
      props: { lines: [{ id: 1 }, { id: 2 }], title: "Cart" },
      controllers: { "demo/cart": { count: 2 } },
    });
    expect(mod.default.Cart.empty.session).toBe("guest");
    expect(typeof mod.default.Cart.gifted).toBe("function");
    expect(mod.default.Cart.gifted().props.title).toBe("Gift");
    expect(Object.keys(mod.default.Chip)).toEqual(["filled", "empty", "error", "loading"]);
    expect([...STANDARD_STATES].sort()).toEqual(["empty", "error", "filled", "loading"]);
    expect(mod.notApplicable).toEqual({ Cart: ["loading", "error"], Chip: [] });
  });

  test("is never written next to, or imported by, the client or server bundles", async () => {
    const root = plugin({ ...BASE, "src/theme/views/pages/Cart.samples.js": CART_SAMPLES });
    const { outDir } = await buildWith(root);
    const emitted = fs.readdirSync(path.join(outDir, "client"));

    expect(emitted).toHaveLength(1);
    expect(fs.readFileSync(path.join(outDir, "client", emitted[0]), "utf8")).not.toContain("Cart");
    expect(fs.existsSync(path.join(outDir, "samples", "samples.mjs"))).toBe(true);
  });

  test("records the state names and the badge in the build context", async () => {
    const root = plugin({
      ...BASE,
      "src/theme/views/pages/Cart.samples.js": CART_SAMPLES,
      "src/theme/views/Chip.svelte": PLAIN,
    });

    await buildWith(root);

    const context = getBuildContext(root);

    expect(context.views.Cart.samples).toEqual(["filled", "empty", "gifted"]);
    expect(context.views.Chip.samples).toEqual([]);
    expect(context.badges.samples).toBe(true); // the only page has `filled`; Chip is a component
  });

  test("the badge needs filled on every page and block", async () => {
    const root = plugin({
      ...BASE,
      "src/theme/views/Banner.svelte": BLOCK,
      "src/theme/views/pages/Cart.samples.js": CART_SAMPLES,
    });

    await buildWith(root);
    expect(getBuildContext(root).badges.samples).toBe(false); // Banner is a block without samples

    fs.writeFileSync(path.join(root, "src/theme/views/Banner.samples.js"), "export default { empty: {} };\n");
    await buildWith(root);
    expect(getBuildContext(root).badges.samples).toBe(false); // no `filled`

    fs.writeFileSync(path.join(root, "src/theme/views/Banner.samples.js"), "export default { filled: {} };\n");
    await buildWith(root);
    expect(getBuildContext(root).badges.samples).toBe(true);
  });

  test("a plugin without samples gets no file and no badge, and a stale file is removed", async () => {
    const root = plugin({ ...BASE, "src/theme/views/pages/Cart.samples.js": CART_SAMPLES });
    const { outDir } = await buildWith(root);

    expect(fs.existsSync(path.join(outDir, "samples", "samples.mjs"))).toBe(true);

    fs.rmSync(path.join(root, "src/theme/views/pages/Cart.samples.js"));
    await buildWith(root);

    expect(fs.existsSync(path.join(outDir, "samples"))).toBe(false);
    expect(getBuildContext(root).badges.samples).toBe(false);
  });

  test("only the client side writes the package", async () => {
    const root = plugin({ ...BASE, "src/theme/views/pages/Cart.samples.js": CART_SAMPLES });
    const { outDir } = await buildWith(root, { side: "server" });

    expect(fs.existsSync(path.join(outDir, "samples"))).toBe(false);
  });

  test("a samples file that imports a package fails with the V3 text", async () => {
    const root = plugin({
      ...BASE,
      "src/theme/views/pages/Cart.samples.js": `import dayjs from 'dayjs';\nexport default { filled: { props: { at: dayjs() } } };\n`,
    });

    await expect(buildWith(root)).rejects.toThrow(/Cart\.samples\.js imports 'dayjs' — sample files are pure data/);
  });

  test("a samples file without a default export fails", async () => {
    const root = plugin({ ...BASE, "src/theme/views/pages/Cart.samples.js": `export const notApplicable = [];\n` });

    await expect(buildWith(root)).rejects.toThrow(/Cart\.samples\.js has no default export/);
  });

  test("a state that is neither an object nor a function fails", async () => {
    const root = plugin({ ...BASE, "src/theme/views/pages/Cart.samples.js": `export default { filled: 3 };\n` });

    await expect(buildWith(root)).rejects.toThrow(/state 'filled' must be an object/);
  });

  test("a samples file with no view only warns", async () => {
    const root = plugin({ ...BASE, "src/theme/views/Ghost.samples.js": FULL("Ghost") });
    const { logs } = await buildWith(root);

    expect(logs.join("\n")).toMatch(/Ghost\.samples\.js belongs to no view/);
  });

  test("compileSamples reports a duplicate name through buildSamples", async () => {
    const root = plugin({
      ...BASE,
      "src/theme/views/pages/Cart.samples.js": CART_SAMPLES,
      "src/theme/views/other/Cart.samples.js": CART_SAMPLES,
    });

    await expect(buildWith(root)).rejects.toThrow(/both hold the samples of Cart/);
  });

  test("compileSamples bundles fixtures into one module", async () => {
    const root = plugin({ ...BASE, "src/theme/views/pages/Cart.samples.js": CART_SAMPLES });
    const { code } = await compileSamples([{ name: "Cart", file: path.join(root, "src/theme/views/pages/Cart.samples.js") }], root);

    expect(code).toContain("export { ");
    expect(code).not.toMatch(/\bfrom\s+['"]/);
  });
});

describe("createSampleController with a sample's controllers patch", () => {
  test("starts from the patched state and records the action calls", async () => {
    const root = plugin({ ...BASE, "src/theme/views/pages/Cart.samples.js": CART_SAMPLES });
    const { outDir } = await buildWith(root);
    const sample = (await loadWritten(outDir)).default.Cart.filled;
    const def = defineController({
      name: "cart",
      version: 1,
      state: () => ({ count: 0, lines: [] }),
      actions: ({ update }) => ({
        add: (line) => (update((s) => ({ ...s, lines: [...s.lines, line] })), Promise.resolve({ ok: true })),
        clear: () => Promise.resolve({ ok: true }),
      }),
    });
    const calls = [];
    const controller = createSampleController(def, sample.controllers["demo/cart"], {
      namespace: "demo",
      onCall: (call) => calls.push(call),
    });

    expect(controller.name).toBe("demo/cart");
    expect(controller.get()).toEqual({ count: 2, lines: [] });

    await controller.actions.add({ id: 9 });
    await controller.actions.clear();

    expect(calls).toEqual([
      { name: "add", args: [{ id: 9 }] },
      { name: "clear", args: [] },
    ]);
    expect(controller.calls).toEqual(calls);
    expect(controller.get()).toEqual({ count: 2, lines: [] }); // fixed state: actions only record
  });
});

describe("pano-plugin samples", () => {
  test("samplesStub has the four standard keys and one line per required prop", () => {
    const stub = samplesStub("Cart", {
      lines: { type: "{ id: number }[]", required: true },
      title: { type: "string", required: true },
      count: { type: "number", required: false },
    });

    for (const key of ["filled", "empty", "error", "loading"]) expect(stub).toContain(`  ${key}: {`);

    expect(stub.match(/^ {6}lines: \[\],/gm)?.length).toBe(4);
    expect(stub.match(/^ {6}title: '',/gm)?.length).toBe(4);
    expect(stub).not.toContain("count:");
    expect(stub).toContain("export const notApplicable = [];");
  });

  test("writes the stub next to the view, which then passes --strict", async () => {
    const root = plugin({ ...BASE });
    const lines = [];
    const code = await runSamples({ root, view: "demo:Cart", out: (l) => lines.push(l), err: (l) => lines.push(l) });
    const file = path.join(root, "src/theme/views/pages/Cart.samples.js");

    expect(code).toBe(0);
    expect(lines).toEqual(["wrote src/theme/views/pages/Cart.samples.js"]);
    expect(fs.readFileSync(file, "utf8")).toContain("lines: [], // { id: number }[], required");

    // the stub compiles to the four states
    const { outDir } = await buildWith(root);

    expect((await loadWritten(outDir)).default.Cart).toHaveProperty("loading");
  });

  test("refuses to overwrite and names unknown views", async () => {
    const root = plugin({ ...BASE, "src/theme/views/pages/Cart.samples.js": CART_SAMPLES });
    const err = [];

    expect(await runSamples({ root, view: "Cart", err: (l) => err.push(l), out: () => {} })).toBe(1);
    expect(err[0]).toMatch(/Cart\.samples\.js exists already/);
    expect(fs.readFileSync(path.join(root, "src/theme/views/pages/Cart.samples.js"), "utf8")).toBe(CART_SAMPLES);

    err.length = 0;
    expect(await runSamples({ root, view: "Nope", err: (l) => err.push(l), out: () => {} })).toBe(1);
    expect(err[0]).toMatch(/no view named Nope — the views are Cart, Chip/);
  });

  test("without a name it lists the views with the command as the hint", async () => {
    const root = plugin({ ...BASE, "src/theme/views/pages/Cart.samples.js": CART_SAMPLES });
    const lines = [];

    expect(await runSamples({ root, out: (l) => lines.push(l), err: () => {} })).toBe(0);
    expect(lines).toEqual(["Cart  src/theme/views/pages/Cart.samples.js", "Chip  no samples — pano-plugin samples Chip"]);
  });

  test("the pano-plugin binary routes the command", async () => {
    const root = plugin({ ...BASE });
    const previous = process.cwd();

    process.chdir(root);

    try {
      const write = process.stdout.write.bind(process.stdout);
      let printed = "";

      process.stdout.write = (chunk) => ((printed += chunk), true);

      try {
        expect(await main(["samples", "Chip"])).toBe(0);
      } finally {
        process.stdout.write = write;
      }

      expect(printed).toContain("wrote src/theme/views/Chip.samples.js");
      expect(fs.existsSync(path.join(root, "src/theme/views/Chip.samples.js"))).toBe(true);
    } finally {
      process.chdir(previous);
    }
  });
});

describe("pano-plugin check --strict", () => {
  const complete = {
    ...BASE,
    "src/theme/views/pages/Cart.samples.js": CART_SAMPLES,
    "src/theme/views/Chip.samples.js": FULL("Chip"),
  };

  test("passes when every view has filled and each standard state or a notApplicable entry", async () => {
    const result = await checkSamples({ root: plugin(complete) });

    expect(result).toEqual({ errors: [], problems: [], notes: [] });
  });

  test("fails on a view without a samples file, with the command as the hint", async () => {
    const root = plugin({ ...BASE, "src/theme/views/Chip.samples.js": FULL("Chip") });
    const result = await checkSamples({ root });

    expect(result.problems).toEqual([
      "src/theme/views/pages/Cart.svelte: Cart has no samples file — run: pano-plugin samples Cart",
    ]);
    expect(result.notes).toEqual(["Cart has no samples — pano-plugin samples Cart"]);
  });

  test("fails on a view without filled", async () => {
    const root = plugin({
      ...complete,
      "src/theme/views/Chip.samples.js": `export const notApplicable = ['loading', 'error'];\nexport default { empty: { props: { label: '' } } };\n`,
    });
    const result = await checkSamples({ root });

    expect(result.problems).toEqual([`src/theme/views/Chip.samples.js: Chip has no 'filled' sample — add filled: { props: { ... } }`]);
  });

  test("fails on a standard state that is neither present nor not applicable", async () => {
    const root = plugin({
      ...complete,
      "src/theme/views/Chip.samples.js": `export default { filled: {}, empty: {}, loading: {} };\n`,
    });
    const result = await checkSamples({ root });

    expect(result.problems).toEqual([
      `src/theme/views/Chip.samples.js: Chip has no 'error' sample — add it, or list 'error' in notApplicable`,
    ]);
  });

  test("rejects a notApplicable that lists filled, an unknown name or a state that exists", async () => {
    const root = plugin({
      ...complete,
      "src/theme/views/Chip.samples.js": `export const notApplicable = ['filled', 'nope', 'empty'];\nexport default { filled: {}, empty: {}, error: {}, loading: {} };\n`,
    });
    const result = await checkSamples({ root });

    expect(result.problems.map((p) => p.replace(/^[^:]+: /, ""))).toEqual([
      "'filled' cannot be listed in notApplicable — every view needs a filled sample",
      "notApplicable names 'nope', which is not a standard state (empty, filled, error, loading)",
      "'empty' is both a sample and in notApplicable — keep one",
    ]);
  });

  test("a samples file with no view is a problem", async () => {
    const root = plugin({ ...complete, "src/theme/views/Ghost.samples.js": FULL("Ghost") });

    expect((await checkSamples({ root })).problems).toEqual([
      "src/theme/views/Ghost.samples.js belongs to no view — there is no Ghost.svelte; rename the file or remove it",
    ]);
  });

  test("the command: strict fails on a view without filled, plain check only lists the view", async () => {
    const root = plugin({
      ...BASE,
      "src/theme/views/Chip.samples.js": `export const notApplicable = ['loading', 'error'];\nexport default { empty: {} };\n`,
    });
    const strict = [];
    const plain = [];
    const run = (strictFlag, sink) =>
      runCheckWithSamples({ root, strict: strictFlag, out: (l) => sink.push(["out", l]), err: (l) => sink.push(["err", l]) });

    expect(await run(true, strict)).toBe(1);
    expect(strict.some(([, l]) => /Chip has no 'filled' sample/.test(l))).toBe(true);
    expect(strict.some(([, l]) => /Cart has no samples file/.test(l))).toBe(true);
    expect(strict.some(([, l]) => /^check failed: \d+ problems?$/.test(l))).toBe(true);

    // plain check: the samples are not what fails it, and the view without samples is a note with the hint
    await run(false, plain);

    const lines = plain.map(([, l]) => l);

    expect(lines).toContain("note: Cart has no samples — pano-plugin samples Cart");
    expect(lines.join("\n")).not.toMatch(/'filled'/);
  });

  test("the command passes --strict for a complete plugin", async () => {
    const root = plugin(complete);
    const lines = [];
    const code = await runCheckWithSamples({ root, strict: true, out: (l) => lines.push(l), err: (l) => lines.push(l) });
    const own = lines.filter((l) => /samples|filled/.test(l) && !/^note: pano-api/.test(l));

    expect(own).toEqual([]);
    expect(lines.some((l) => /^public \(readable\): 2 views/.test(l))).toBe(true);
    // a complete plugin may still fail on something else (the sdk pin of this machine); samples add nothing
    expect([0, 1]).toContain(code);
  });
});
