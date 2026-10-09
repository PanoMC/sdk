import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** @type {string[]} */
const created = [];

/**
 * Writes a throw-away plugin folder from a `{ 'relative/path': 'content' }` map.
 * The folder always has `gradle.properties` for `pano-plugin-market` (namespace `market`).
 *
 * @param {Record<string, string>} files
 * @returns {string} absolute root
 */
export function makePlugin(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pano-kit-rules-"));
  created.push(root);

  const all = { "gradle.properties": "pluginId=pano-plugin-market\n", ...files };

  for (const [relative, content] of Object.entries(all)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }

  return root;
}

export function cleanup() {
  for (const root of created.splice(0)) fs.rmSync(root, { recursive: true, force: true });
}

/**
 * A view that is valid under every rule: used as the base of the fixtures.
 */
export const GOOD_VIEW = `<script>
  import { onMount } from "svelte";
  import { _ } from "svelte-i18n";
  import { api } from "@panomc/sdk";
  import Child from "./Child.svelte";
  import { sale } from "../lib/sale.js";
</script>
<div>{sale(1)}<Child /></div>
`;

export const GOOD_FILES = {
  "src/theme/views/ProductCard.svelte": GOOD_VIEW,
  "src/theme/views/Child.svelte": "<p>child</p>\n",
  "src/theme/lib/sale.js": 'import { round } from "./round.js";\nexport const sale = (n) => round(n);\n',
  "src/theme/lib/round.js": "export const round = (n) => Math.round(n);\n",
};

/**
 * Runs a rollup plugin's `buildStart` the way rollup does, collecting errors and warnings.
 *
 * @param {import('rollup').Plugin} plugin
 * @returns {Promise<{ error: Error | null, warnings: string[] }>}
 */
export async function runBuildStart(plugin) {
  /** @type {string[]} */
  const warnings = [];
  /** @type {Error | null} */
  let error = null;

  const context = {
    warn: (/** @type {any} */ log) => warnings.push(typeof log === "string" ? log : log.message),
    error: (/** @type {any} */ log) => {
      throw new Error(typeof log === "string" ? log : log.message);
    },
    addWatchFile: () => {},
  };

  const hook = /** @type {any} */ (plugin.buildStart);

  try {
    await (typeof hook === "function" ? hook : hook.handler).call(context, {});
  } catch (caught) {
    error = /** @type {Error} */ (caught);
  }

  return { error, warnings };
}
