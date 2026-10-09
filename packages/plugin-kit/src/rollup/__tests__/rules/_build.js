import { rollup } from "rollup";
import svelte from "rollup-plugin-svelte";
import path from "node:path";

/**
 * Builds a fixture plugin's views into one ES bundle (client side) with the given kit plugins.
 * The entry imports every `.svelte` file given in `views` and re-exports it.
 *
 * @param {string} root
 * @param {string[]} views paths relative to root
 * @param {import('rollup').Plugin[]} kit plugins that run after the Svelte compiler
 * @param {{ onwarn?: (message: string) => void }} [options]
 * @returns {Promise<{ code: string }>}
 */
export async function buildViews(root, views, kit, options = {}) {
  const entry = "\0entry";
  const source = views
    .map((view, index) => `export { default as V${index} } from ${JSON.stringify(path.join(root, view))};`)
    .join("\n");

  const bundle = await rollup({
    input: entry,
    external: [/^@panomc\//, /^svelte/],
    onwarn: (warning) => options.onwarn?.(warning.message),
    plugins: [
      {
        name: "test-entry",
        resolveId: (id) => (id === entry ? entry : null),
        load: (id) => (id === entry ? source : null),
      },
      svelte({ emitCss: false, compilerOptions: { generate: "client" } }),
      ...kit,
    ],
  });

  const { output } = await bundle.generate({ format: "es" });
  await bundle.close();
  return { code: output[0].code };
}
