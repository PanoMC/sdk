import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rollup } from "rollup";
import { panoControllers } from "../../controllers.js";
import { panoMeta } from "../../meta.js";
import { panoTypes } from "../../types.js";

/** Cart controller of the fixture plugin; `retry` and `replaceRequest` are the keys the lock tests remove. */
export function cartSource({ version = 1, actions = ["add", "setQuantity", "clear", "retry"], state = ["status", "lines", "count", "replaceRequest"], extra = "" } = {}) {
  const initial = { status: "'idle'", lines: "[]", count: "0", replaceRequest: "null" };
  const stateBody = state.map((key) => `${key}: ${initial[key] ?? "null"}`).join(", ");
  const actionBody = actions
    .map((name) =>
      name === "add"
        ? `add(line) { c.update((s) => ({ ...s, lines: [...s.lines, line], count: double(salePrice(s.lines.length + 1)) })); return Promise.resolve({ ok: true }); }`
        : `${name}() { return Promise.resolve({ ok: true }); }`,
    )
    .join(",\n    ");

  return `import { defineController } from '@panomc/plugin-kit/controller';
import { double } from 'tiny-lib';
import { salePrice } from '../lib/sale.js';
${extra}
export default defineController({
  name: 'cart',
  version: ${version},
  state: () => ({ ${stateBody} }),
  actions: (c) => ({
    ${actionBody}
  }),
});
`;
}

export const FORMAT_SOURCE = `import { defineController } from '@panomc/plugin-kit/controller';
import { pad } from './_private.js';

export default defineController({
  name: 'format',
  version: 1,
  scope: 'instance',
  actions: ({ host }) => ({
    money: (cents) => pad(String(cents / 100)) + ' ' + host.t('plugins.pano-plugin-demo.currency'),
  }),
});
`;

export const TYPES_SOURCE = `/**
 * @typedef {Object} CartState
 * @property {'idle' | 'busy'} status
 * @property {{ id: number }[]} lines
 * @property {number} count
 */

export {};
`;

/**
 * Creates a plugin folder in the temp directory.
 *
 * @param {Record<string, string | null>} [overrides] path -> content (null removes a default file)
 * @returns {string} plugin root
 */
const created = [];

/** Removes every fixture folder made so far (call from afterAll). */
export function cleanupFixtures() {
  for (const root of created.splice(0)) fs.rmSync(root, { recursive: true, force: true });
}

export function makeFixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pano-kit-fixture-"));
  created.push(root);
  const files = {
    "gradle.properties": "pluginId=pano-plugin-demo\n",
    "package.json": JSON.stringify({ name: "demo", version: "1.2.3" }),
    "node_modules/tiny-lib/package.json": JSON.stringify({ name: "tiny-lib", version: "1.0.0", type: "module", main: "index.js" }),
    "node_modules/tiny-lib/index.js": "export const double = (n) => n * 2;\n",
    "src/theme/lib/sale.js": "export function salePrice(n) {\n  return n + 1;\n}\n",
    "src/theme/controllers/cart.js": cartSource(),
    "src/theme/controllers/format.js": FORMAT_SOURCE,
    "src/theme/controllers/_private.js": "export const pad = (s) => s.padStart(6, '0');\n",
    "src/theme/controllers/nested/ignored.js": "throw new Error('sub-folders are private code, never entries');\n",
    "src/theme/controllers/types.js": TYPES_SOURCE,
    ...overrides,
  };

  for (const [file, content] of Object.entries(files)) {
    if (content === null) continue;

    const target = path.join(root, file);

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }

  return root;
}

export function write(root, file, content) {
  const target = path.join(root, file);

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

export function read(root, file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

export const OUT = "src/main/resources/plugin-ui";

/**
 * Runs one rollup build with the three plugins, the way the preset composes them.
 *
 * @param {string} root
 * @param {{ watch?: boolean, warnings?: string[], plugins?: import('rollup').Plugin[], version?: string }} [options]
 */
export async function build(root, { watch = false, warnings = [], plugins = [], version } = {}) {
  const options = { root };
  const bundle = await rollup({
    input: "pano:test-entry",
    onwarn: (warning) => warnings.push(warning.message),
    plugins: [
      {
        name: "test-entry",
        resolveId: (id) => (id === "pano:test-entry" ? "\0entry" : null),
        load: (id) => (id === "\0entry" ? "export default 1;" : null),
      },
      ...plugins,
      panoControllers(options),
      panoTypes(options),
      panoMeta({ ...options, watch, version }),
    ],
  });

  try {
    await bundle.write({ dir: path.join(root, OUT, "client"), format: "es" });
  } finally {
    await bundle.close();
  }
}
