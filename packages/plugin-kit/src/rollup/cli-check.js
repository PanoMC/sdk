import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { checkStyles } from "../styles/check-styles.js";
import { analyzeProject, resolveProject, viewImportsMode } from "./rules.js";
import { listControllerFiles } from "./controllers.js";
import { enumerateControllers, lockSectionOf } from "./meta.js";
import { diffSection, readLock } from "./lock.js";
import { buildLockSection, scanViews } from "./views.js";
import { checkSvelteVersion, findPackageDir } from "./index.js";
import { createClassPolicy } from "./integrate.js";

/**
 * `pano-plugin check [--strict] [--styles badge]` (doc 02 section 8).
 *
 * Runs, without writing anything into the plugin folder:
 *   - the build rules V1-V3 and V5 (migration mode turns V1 and V5 into warnings),
 *   - the lock comparison for views and controllers (a promise removed without a raised number),
 *   - the style lint of doc 03 (`core`, or `badge` with `--styles badge`),
 *   - the Svelte version pin of the sdk,
 *   - `pano-api check-paths` of the sdk (skipped, with a note, when no sdk is found),
 *   - the notice for an old hand-copied `rollup.config.js`.
 *
 * `--strict` makes warnings fail the check as well. The last line is always
 * `public (readable): N views, M helpers · closed: K controllers`.
 */

/**
 * @typedef {object} CheckOptions
 * @property {string} [root] plugin root, default the current directory
 * @property {boolean} [strict] warnings fail the check
 * @property {'core' | 'badge'} [styles] lint level, default `core`
 * @property {(line: string) => void} [out] stdout
 * @property {(line: string) => void} [err] stderr
 */

/**
 * The sdk folder: `PANO_SDK_DIR`, the installed `@panomc/sdk`, or, in the theme-core workspace, the
 * sibling package of the kit.
 *
 * @param {string} root
 * @param {string | null} configured
 * @returns {string | null}
 */
export function findSdkDir(root, configured) {
  if (configured) return configured;

  const installed = findPackageDir(root, "@panomc/sdk");

  if (installed) return installed;

  const sibling = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../sdk");

  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(sibling, "package.json"), "utf8"));

    if (pkg.name === "@panomc/sdk") return sibling;
  } catch {
    // not in the workspace
  }

  return null;
}

/**
 * Runs `fn` and returns what it printed with `console.warn`.
 *
 * @template T
 * @param {() => T} fn
 * @returns {{ result?: T, error?: Error, warnings: string[] }}
 */
function captureWarnings(fn) {
  const original = console.warn;
  /** @type {string[]} */
  const warnings = [];

  console.warn = (...args) => {
    warnings.push(args.join(" ").replace(/^\[pano\] WARNING: /, ""));
  };

  try {
    return { result: fn(), warnings };
  } catch (error) {
    return { error: /** @type {Error} */ (error), warnings };
  } finally {
    console.warn = original;
  }
}

/**
 * @param {CheckOptions} [options]
 * @returns {Promise<number>} the exit code: 0 passed, 1 problems found
 */
export async function runCheck(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const out = options.out ?? ((line) => process.stdout.write(`${line}\n`));
  const err = options.err ?? ((line) => process.stderr.write(`${line}\n`));
  const level = options.styles ?? "core";
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  /** @type {string[]} */
  const notes = [];
  let counts = { views: 0, helpers: 0, controllers: 0 };

  /** @param {string} message */
  const fail = (message) => errors.push(String(message).replace(/^\[pano-plugin\] /, ""));

  let config;

  try {
    config = await loadConfig(root);
  } catch (error) {
    fail(/** @type {Error} */ (error).message);
  }

  if (config) {
    const sdkDir = findSdkDir(root, config.sdkDir);

    // ---- Svelte pin ---------------------------------------------------------------------------
    {
      const { error, warnings: found } = captureWarnings(() => checkSvelteVersion({ root, sdkDir }));

      warnings.push(...found);
      if (error) fail(error.message);
    }

    // ---- V1-V3, V5 -----------------------------------------------------------------------------
    const project = await resolveProject({
      root,
      viewDirs: config.viewDirs,
      namespace: config.namespace,
    });
    const analysis = await analyzeProject(project);
    const mode = viewImportsMode();

    for (const violation of analysis.violations) {
      if (mode === "warn" && (violation.rule === "V1" || violation.rule === "V5")) {
        warnings.push(`${violation.message} (PANO_VIEW_IMPORTS=warn: migration mode, this will be an error)`);
      } else {
        fail(violation.message);
      }
    }

    counts = {
      views: analysis.views.size,
      helpers: new Set([...analysis.helpers.values()].flat()).size,
      controllers: listControllerFiles(project.controllersDir).length,
    };

    // ---- lock comparison -------------------------------------------------------------------------
    /** @type {Awaited<ReturnType<typeof scanViews>> | null} */
    let scan = null;

    try {
      scan = await scanViews({ dirs: config.viewDirs, namespace: config.namespace, pluginId: config.pluginId, root });
      warnings.push(...scan.warnings);
    } catch (error) {
      fail(/** @type {Error} */ (error).message);
    }

    let lock = { format: 1 };

    try {
      lock = readLock(root);
    } catch (error) {
      fail(/** @type {Error} */ (error).message);
    }

    if (scan) {
      const found = scan;
      const policy = createClassPolicy({ root, ns: config.namespace, scan: () => found, styles: config.styles });
      const { breaking } = diffSection(
        "views",
        lock.views,
        buildLockSection(scan, lock.views, (info) => policy.infoOf(info).classes),
      );

      for (const message of breaking) fail(message);
    }

    if (counts.controllers > 0) {
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "pano-check-"));

      try {
        const enumeration = await enumerateControllers({
          root,
          outDir: temporary,
          pluginId: config.pluginId,
          namespace: config.namespace,
        });
        const { breaking } = diffSection("controllers", lock.controllers, lockSectionOf(enumeration));

        for (const message of breaking) fail(message);
      } catch (error) {
        fail(/** @type {Error} */ (error).message);
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
      }
    }

    // ---- style lint ------------------------------------------------------------------------------
    try {
      const findings = checkStyles({
        root,
        ns: config.namespace,
        views: scan
          ? [...scan.views.values()].map((info) => ({ name: info.name, file: info.rel }))
          : [],
        styleAttrAllow: config.styles.styleAttrAllow,
        dynamicClassAllow: config.styles.dynamicClassAllow,
        safelist: config.styles.safelist,
        level,
      });

      for (const finding of findings) {
        const text = `${finding.file}:${finding.line} [${finding.rule}] ${finding.message}`;

        if (finding.level === "error") fail(text);
        else warnings.push(text);
      }
    } catch (error) {
      fail(/** @type {Error} */ (error).message);
    }

    // ---- API paths -----------------------------------------------------------------------------
    const checkPathsFile = sdkDir ? path.join(sdkDir, "bin/api/check-paths.mjs") : null;

    if (checkPathsFile && fs.existsSync(checkPathsFile)) {
      try {
        const { checkPaths } = await import(pathToFileURL(checkPathsFile).href);
        const result = checkPaths({ root, pluginId: config.pluginId });

        for (const message of result.errors) warnings.push(`pano-api check-paths: ${message}`);
        for (const problem of result.problems) fail(`${problem} — fix the path (pano-api check-paths ${path.relative(process.cwd(), root) || "."} lists them all)`);
      } catch (error) {
        warnings.push(`pano-api check-paths could not run (${/** @type {Error} */ (error).message})`);
      }
    } else {
      notes.push("pano-api check-paths skipped: no @panomc/sdk found (set PANO_SDK_DIR or install @panomc/sdk)");
    }

    // ---- old hand-copied rollup.config.js ---------------------------------------------------------
    const rollupConfig = path.join(root, "rollup.config.js");

    if (fs.existsSync(rollupConfig)) {
      const text = fs.readFileSync(rollupConfig, "utf8");

      if (!text.includes("@panomc/plugin-kit")) {
        warnings.push(
          "rollup.config.js is an old hand-copied config and gets none of the views, controllers or contract files — replace it with: import { panoPlugin } from '@panomc/plugin-kit/rollup'; export default panoPlugin();",
        );
      }
    }
  }

  // ---- report ----------------------------------------------------------------------------------
  const strict = options.strict === true;

  for (const message of errors) err(`error: ${message}`);
  for (const message of warnings) err(`${strict ? "error (--strict)" : "warning"}: ${message}`);
  for (const message of notes) out(`note: ${message}`);

  const failing = errors.length + (strict ? warnings.length : 0);

  out(
    failing === 0
      ? `check passed (${warnings.length} warning${warnings.length === 1 ? "" : "s"})`
      : `check failed: ${failing} problem${failing === 1 ? "" : "s"}`,
  );
  out(
    `public (readable): ${counts.views} view${counts.views === 1 ? "" : "s"}, ${counts.helpers} helper${counts.helpers === 1 ? "" : "s"} · closed: ${counts.controllers} controller${counts.controllers === 1 ? "" : "s"}`,
  );

  return failing === 0 ? 0 : 1;
}
