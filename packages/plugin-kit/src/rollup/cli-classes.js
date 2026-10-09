import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config.js";
import { addPartClasses, addRootClass } from "../styles/semantic-classes.js";
import { listFiles } from "./rules.js";

/**
 * `pano-plugin classes [--fix]` (doc 03 section 1.2).
 *
 * Lists the semantic classes the sources are missing: the root class of every view and the part
 * classes of elements with a Bootstrap component class. `--fix` writes them into the sources, so the
 * root class is committed too (the `badge` lint wants it there). Idempotent: a second run lists nothing.
 *
 * @param {{ root?: string, fix?: boolean, out?: (line: string) => void, err?: (line: string) => void }} [options]
 * @returns {Promise<number>} 0 when done (or nothing to add), 1 when the config or a source is broken
 */
export async function runClasses(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const out = options.out ?? ((line) => process.stdout.write(`${line}\n`));
  const err = options.err ?? ((line) => process.stderr.write(`${line}\n`));
  let config;

  try {
    config = await loadConfig(root);
  } catch (error) {
    err(`error: ${String(/** @type {Error} */ (error).message).replace(/^\[pano-plugin\] /, "")}`);

    return 1;
  }

  const dirs = config.viewDirs.map((dir) => path.resolve(root, dir));
  const files = listFiles(dirs, (file) => file.endsWith(".svelte"));
  let total = 0;
  let failed = false;

  for (const file of files) {
    const view = path.basename(file, ".svelte");
    const relative = path.relative(root, file).split(path.sep).join("/");
    const source = fs.readFileSync(file, "utf8");

    try {
      const root_ = addRootClass(source, { ns: config.namespace, view });
      const parts = addPartClasses(root_.code, { ns: config.namespace, view });

      for (const message of root_.warnings) err(`warning: ${relative}: ${message}`);

      const names = [
        ...root_.added.map((name) => ({ line: 0, class: name })),
        ...parts.added,
      ];

      for (const item of names) {
        out(`${relative}${item.line ? `:${item.line}` : ""}  + ${item.class}`);
      }

      total += names.length;

      if (options.fix && parts.code !== source) fs.writeFileSync(file, parts.code);
    } catch (error) {
      failed = true;
      err(`error: ${relative}: ${/** @type {Error} */ (error).message}`);
    }
  }

  if (total === 0 && !failed) out("classes: nothing to add");
  else if (!failed) {
    out(
      options.fix
        ? `classes: ${total} class${total === 1 ? "" : "es"} written`
        : `classes: ${total} class${total === 1 ? "" : "es"} to add — run pano-plugin classes --fix to write them`,
    );
  }

  return failed ? 1 : 0;
}
