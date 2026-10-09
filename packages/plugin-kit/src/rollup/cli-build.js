import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * `pano-plugin build` and the shared config loader of `dev`.
 *
 * The plugin's `rollup.config.js` (`export default panoPlugin();`) is imported and every config it
 * returns is built and written, in order, as `rollup -c` would. A failed lock comparison, a build
 * rule or a missing import ends the command with exit code 1 and the message of the failing plugin.
 */

export const CONFIG_FILE = "rollup.config.js";

/**
 * @param {string} root
 * @param {string} [file] config file, relative to `root`
 * @returns {Promise<import('rollup').RollupOptions[]>}
 */
export async function loadRollupConfigs(root, file = CONFIG_FILE) {
  const configFile = path.resolve(root, file);

  if (!fs.existsSync(configFile)) {
    throw new Error(
      `no ${file} in ${root} — create it with: import { panoPlugin } from '@panomc/plugin-kit/rollup'; export default panoPlugin();`,
    );
  }

  let exported = (await import(pathToFileURL(configFile).href)).default;

  if (typeof exported === "function") exported = exported({});

  exported = await exported;

  return Array.isArray(exported) ? exported : [exported];
}

/**
 * @param {unknown} error
 * @returns {string}
 */
export function describeError(error) {
  const e = /** @type {any} */ (error);
  const where = e?.loc?.file ?? e?.id;
  const position = e?.loc?.line ? `:${e.loc.line}` : "";
  const message = String(e?.message ?? e);

  // panoViews and the rules already start their messages with file:line
  return where && !message.includes(path.basename(where)) ? `${message} (${where}${position})` : message;
}

/**
 * @param {{ root?: string, config?: string, out?: (line: string) => void, err?: (line: string) => void }} [options]
 * @returns {Promise<number>}
 */
export async function runBuild(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const out = options.out ?? ((line) => process.stdout.write(`${line}\n`));
  const err = options.err ?? ((line) => process.stderr.write(`${line}\n`));
  const { rollup } = await import("rollup");
  /** @type {import('rollup').RollupBuild | null} */
  let bundle = null;
  let built = 0;

  try {
    const configs = await loadRollupConfigs(root, options.config);

    for (const config of configs) {
      bundle = await rollup(config);

      for (const output of [].concat(/** @type {any} */ (config.output ?? []))) {
        await bundle.write(output);
        built += 1;
      }

      await bundle.close();
      bundle = null;
    }
  } catch (error) {
    if (bundle) await bundle.close().catch(() => {});

    err(`error: ${describeError(error).replace(/^\[pano-plugin\] /, "")}`);

    return 1;
  }

  out(`build: ${built} bundle${built === 1 ? "" : "s"} written`);

  return 0;
}
