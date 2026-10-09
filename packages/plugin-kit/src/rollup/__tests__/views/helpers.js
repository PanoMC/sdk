import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rollup } from "rollup";
import svelte from "rollup-plugin-svelte";
import { panoViews } from "../../views.js";

const made = [];

/**
 * Makes a throwaway plugin folder: gradle.properties plus the given files.
 *
 * @param {Record<string, string>} files path (relative to the plugin root) -> content
 * @param {string} [pluginId]
 * @returns {string} the plugin root
 */
export function makePlugin(files, pluginId = "pano-plugin-demo") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kit-views-"));

  made.push(root);
  fs.writeFileSync(path.join(root, "gradle.properties"), `pluginId=${pluginId}\nversion=1.2.3\n`);

  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }

  return root;
}

export function cleanup() {
  while (made.length) fs.rmSync(made.pop(), { recursive: true, force: true });
}

/**
 * Builds `src/main.js` of the fixture with panoViews (and the svelte compiler) and writes
 * the bundle plus the contract files into the plugin folder.
 *
 * @param {string} root
 * @param {Partial<import('../../views.js').PanoViewsOptions>} [options]
 * @param {{ write?: boolean }} [run]
 */
export async function build(root, options = {}, run = { write: true }) {
  const views = panoViews({
    dirs: ["src/theme/views"],
    namespace: "demo",
    pluginId: "pano-plugin-demo",
    root,
    outDir: path.join(root, "out"),
    ...options,
  });
  const logs = [];
  const bundle = await rollup({
    input: path.join(root, "src/main.js"),
    external: [/^@panomc\/sdk/, /^svelte/],
    onwarn: (warning) => logs.push(String(warning.message).replace(/^\[plugin pano-views\] /, "")),
    plugins: [views, svelte({ compilerOptions: { generate: "server" } })],
  });

  const result = run.write === false ? await bundle.generate({ format: "es" }) : await bundle.write({ dir: path.join(root, "out/server"), format: "es" });

  await bundle.close();

  return { views, logs, output: result.output, code: result.output.map((o) => o.code ?? "").join("\n") };
}

/** Builds and returns the error, or fails the test when the build passes. */
export async function buildError(root, options) {
  try {
    await build(root, options);
  } catch (error) {
    error.message = String(error.message).replace(/^\[plugin pano-views\] /, "");

    return error;
  }

  throw new Error("expected the build to fail");
}

export const read = (root, file) => fs.readFileSync(path.join(root, file), "utf8");
export const exists = (root, file) => fs.existsSync(path.join(root, file));
export const MAIN = `import views from "pano:views";\nexport default views;\n`;
