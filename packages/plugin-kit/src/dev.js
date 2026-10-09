import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig } from "./config.js";

/**
 * `pano-plugin dev [--pano <url>]` (doc 02 section 8): `bun run dev` of a plugin.
 *
 *  1. builds the plugin jar once, with `-Pnoui`, when `build/libs` holds none (the UI comes from the
 *     watch build below, so the first run does not wait for it);
 *  2. reads `developmentMode` from the site info of the running Pano and, when it is off, prints the
 *     panel path of the switch (a plugin's UI is only reloaded from the folder while it is on);
 *  3. starts the rollup watch with `DEV=true` (unminified, Svelte dev mode).
 *
 * Every outside effect is a parameter, so the command is testable without Gradle, a network or rollup.
 */

export const DEFAULT_PANO_URL = "http://localhost:8088";
export const DEV_MODE_PANEL_PATH = "Panel → Platform Settings → Development Mode";

/** Site info paths, newest first (`/api/v1/site-info` after the v1 migration, `/api/site-info` before). */
const SITE_INFO_PATHS = ["/api/v1/site-info", "/api/site-info"];

/**
 * The plugin jars under `build/libs`.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function builtJars(root) {
  const dir = path.join(root, "build", "libs");

  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".jar") && !name.endsWith("-plain.jar"))
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

/**
 * @param {string} url
 * @param {typeof fetch} request
 * @returns {Promise<{ reachable: boolean, developmentMode: boolean | null }>}
 */
export async function readDevelopmentMode(url, request = fetch) {
  const base = url.replace(/\/+$/, "");

  for (const sitePath of SITE_INFO_PATHS) {
    try {
      const response = await request(base + sitePath, { signal: AbortSignal.timeout(3000) });

      if (!response.ok) continue;

      const body = /** @type {any} */ (await response.json());
      // before the v1 envelope the fields sit beside `result: "ok"`
      const info = body && typeof body.result === "object" ? body.result : body;

      return { reachable: true, developmentMode: typeof info?.developmentMode === "boolean" ? info.developmentMode : null };
    } catch {
      return { reachable: false, developmentMode: null };
    }
  }

  return { reachable: true, developmentMode: null };
}

/**
 * @typedef {object} DevOptions
 * @property {string} [root] plugin root, default the current directory
 * @property {string} [pano] Pano address, default `PANO_URL` or http://localhost:8088
 * @property {(line: string) => void} [out]
 * @property {(line: string) => void} [err]
 * @property {(command: string, args: string[], cwd: string) => number} [run] runs a command with inherited output, returns its exit code
 * @property {typeof fetch} [request]
 * @property {(root: string) => Promise<import('rollup').RollupOptions[]>} [loadConfigs]
 * @property {(configs: import('rollup').RollupOptions[]) => { on: (event: string, handler: (event: any) => void) => any, close: () => Promise<void> | void }} [watch]
 * @property {Promise<void>} [stop] resolves when the watch should end (default: SIGINT / SIGTERM)
 */

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 * @returns {number}
 */
function defaultRun(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });

  return result.status ?? 1;
}

/**
 * @param {DevOptions} [options]
 * @returns {Promise<number>}
 */
export async function runDev(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const out = options.out ?? ((line) => process.stdout.write(`${line}\n`));
  const err = options.err ?? ((line) => process.stderr.write(`${line}\n`));
  const run = options.run ?? defaultRun;
  const panoUrl = options.pano ?? process.env.PANO_URL ?? DEFAULT_PANO_URL;
  let config;

  try {
    config = await loadConfig(root);
  } catch (error) {
    err(`error: ${String(/** @type {Error} */ (error).message).replace(/^\[pano-plugin\] /, "")}`);

    return 1;
  }

  // 1. the jar
  let builtJar = false;

  if (builtJars(root).length === 0) {
    const windows = process.platform === "win32";
    const wrapper = windows ? "gradlew.bat" : "gradlew";

    if (!fs.existsSync(path.join(root, wrapper))) {
      err(`error: no build/libs jar and no ${wrapper} in ${root} — build the plugin once with: gradle build -Pnoui`);

      return 1;
    }

    out(`dev: no jar in build/libs yet — building ${config.pluginId} once (this takes a few minutes)`);

    const code = run(windows ? wrapper : `./${wrapper}`, ["build", "-Pnoui"], root);

    if (code !== 0) {
      err(`error: ./${wrapper} build -Pnoui failed (exit ${code}) — fix the Kotlin build, then run bun run dev again`);

      return 1;
    }

    builtJar = true;
    out("dev: jar built — restart Pano once so it loads the plugin");
  }

  // 2. Development Mode
  const mode = await readDevelopmentMode(panoUrl, options.request);

  if (!mode.reachable) {
    out(`dev: Pano is not reachable at ${panoUrl} (--pano <url> or PANO_URL) — start it${builtJar ? "" : ", and restart it once if this plugin is new"}`);
  } else if (mode.developmentMode === false) {
    out(`dev: Development Mode is off — Pano will not reload this plugin's UI. Switch it on in the panel: ${DEV_MODE_PANEL_PATH}`);
  }

  // 3. the watch
  const previousDev = process.env.DEV;

  process.env.DEV = "true";

  /** The command may run inside another process (tests): leave its environment as found. */
  const restoreEnv = () => {
    if (previousDev === undefined) delete process.env.DEV;
    else process.env.DEV = previousDev;
  };

  let configs;

  try {
    configs = await (options.loadConfigs ?? (async (folder) => (await import("./rollup/cli-build.js")).loadRollupConfigs(folder)))(root);
  } catch (error) {
    restoreEnv();
    err(`error: ${String(/** @type {Error} */ (error).message).replace(/^\[pano-plugin\] /, "")}`);

    return 1;
  }

  const watch = options.watch ?? (await import("rollup")).watch;
  const watcher = watch(configs);
  let failed = false;

  let elapsed = 0;

  watcher.on("event", (event) => {
    if (event.code === "START") {
      failed = false;
      elapsed = 0;
    } else if (event.code === "BUNDLE_END") {
      elapsed += event.duration ?? 0;
      event.result?.close?.();
    } else if (event.code === "ERROR") {
      failed = true;
      err(`error: ${String(event.error?.message ?? event.error).replace(/^\[pano-plugin\] /, "")}`);
      event.result?.close?.();
    } else if (event.code === "END" && !failed) {
      // all targets (server, client, controllers) are written once rollup says END
      out(`dev: built in ${elapsed} ms`);
    }
  });

  out("dev: watching src/ — press Ctrl+C to stop");

  await (options.stop ??
    new Promise((resolve) => {
      process.once("SIGINT", () => resolve(undefined));
      process.once("SIGTERM", () => resolve(undefined));
    }));

  await watcher.close();
  restoreEnv();

  return failed ? 1 : 0;
}
