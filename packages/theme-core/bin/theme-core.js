#!/usr/bin/env bun
/**
 * theme-core CLI — the theme author's single entry point.
 *
 *   bunx @panomc/theme-core new [name]     scaffold a working Pano theme
 *   bunx @panomc/theme-core sync           regenerate route shims + host-provides stubs
 *   bunx @panomc/theme-core check [--strict] [--fix]
 *                                  contract lint (view registry, svelte pin, …); --strict makes warnings fail,
 *                                  --fix writes controller pins into theme.config.js
 *   bunx @panomc/theme-core list-views     list engine and plugin views, with contract and overridden marks
 *   bunx @panomc/theme-core eject-view <id | ns:* [--pages]> [--from <dir|zip>]
 *                                  copy an engine view or a plugin's readable view into src/views/
 *                                  and register it in theme.config.js
 *   bunx @panomc/theme-core accept <id>
 *                                  take over the plugin's current contract for an override
 *   bunx @panomc/theme-core contracts pull [--from <dir|zip>]
 *                                  refresh plugin-contracts/ from the installed plugins
 *   bunx @panomc/theme-core package        runs `check --strict`, then a reproducible zip of build/ (the zip
 *                                  sha256 is the premium license identity)
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pc, version, DOCS_URL } from "./ui.js";

let binDir = dirname(fileURLToPath(import.meta.url));
const [cmd, ...args] = process.argv.slice(2);

// Inside a theme, always drive the THEME's own installed engine, not whatever
// version bunx happened to fetch (a stale `latest` here would desync the CLI
// from the code the theme actually runs). `new` is exempt — it creates themes.
{
  const localBin = join(process.cwd(), "node_modules", "@panomc", "theme-core", "bin");
  if (cmd !== "new" && existsSync(join(localBin, "theme-core.js")) && localBin !== binDir) {
    binDir = localBin;
  }
}

function run(script, extra = []) {
  const r = spawnSync("bun", [join(binDir, script), ...extra], {
    stdio: "inherit",
    cwd: process.cwd(),
  });
  process.exit(r.status ?? 0);
}

/** name → one-line description, in help-display order. */
const COMMANDS = {
  new: "scaffold a working Pano theme (interactive when run with no name)",
  sync: "regenerate route shims + host-provides stubs + merged lang",
  check: "contract lint — view registry, svelte pin, slots, settings (--strict: warnings fail, --fix: write controller pins)",
  "list-views": "list engine and plugin views with contract and overridden marks",
  "eject-view": "copy an engine or plugin view into src/views/ and register it",
  accept: "take over a plugin's current contract for an override",
  contracts: "pull plugin view contracts into plugin-contracts/",
  "dev-hint": "print where the theme dev server URL goes in the panel (called by dev:ui)",
  package: "check --strict, then a reproducible zip of build/ (its sha256 is the license identity)",
};

function printHelp() {
  const pad = Math.max(...Object.keys(COMMANDS).map((k) => k.length));
  const lines = [
    `${pc.bgCyan(pc.black(" pano "))} ${pc.bold("theme-core")} ${pc.dim(`v${version}`)}`,
    "",
    pc.dim("The Pano theme engine CLI."),
    "",
    pc.bold("Usage"),
    `  ${pc.cyan("bunx @panomc/theme-core")} ${pc.yellow("<command>")} ${pc.dim("[options]")}`,
    "",
    pc.bold("Commands"),
  ];
  for (const [name, desc] of Object.entries(COMMANDS)) {
    const arg =
      name === "eject-view"
        ? pc.dim(" <id | ns:*>")
        : name === "accept"
          ? pc.dim(" <id>")
          : name === "contracts"
            ? pc.dim(" pull")
            : "";
    lines.push(`  ${pc.yellow(name.padEnd(pad))}${arg}  ${pc.dim(desc)}`);
  }
  lines.push(
    "",
    pc.bold("Examples"),
    `  ${pc.cyan("bunx @panomc/theme-core new")}              ${pc.dim("interactive scaffolder")}`,
    `  ${pc.cyan("bunx @panomc/theme-core new my-theme")}     ${pc.dim("scaffold immediately")}`,
    `  ${pc.cyan("bunx @panomc/theme-core eject-view LoginView")}`,
    `  ${pc.cyan("bunx @panomc/theme-core eject-view market:ProductCard")}`,
    `  ${pc.cyan("bunx @panomc/theme-core eject-view market:* --pages")}`,
    "",
    `${pc.bold("Docs")}  ${pc.cyan(DOCS_URL)}`,
    "",
  );
  console.log(lines.join("\n"));
}

/** Cheap edit distance for the "did you mean" hint on an unknown command. */
function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

function suggest(input) {
  const names = Object.keys(COMMANDS);
  // Prefix match first, then closest edit distance within a small threshold.
  const prefix = names.find((n) => n.startsWith(input));
  if (prefix) return prefix;
  let best = null;
  let bestD = Infinity;
  for (const n of names) {
    const d = levenshtein(input, n);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return bestD <= 3 ? best : null;
}

/**
 * The two lines `dev:ui` prints once before it starts the dev server: the panel field that takes the dev server URL
 * and the switch that must be on. `--port <n>` (default 3000) names the URL.
 */
function printDevHint(rest) {
  const at = rest.indexOf("--port");
  const port = at >= 0 && /^\d+$/.test(rest[at + 1] ?? "") ? rest[at + 1] : "3000";

  console.log(
    [
      `${pc.cyan("dev")}  Panel → Appearance → Front-end → Theme dev server: ${pc.bold(`http://localhost:${port}`)}`,
      `${pc.cyan("dev")}  Development Mode must be on (Panel → Platform Settings → Development Mode).`,
    ].join("\n"),
  );
}

switch (cmd) {
  case undefined:
  case "help":
  case "--help":
  case "-h":
    printHelp();
    break;

  case "--version":
  case "-v":
    console.log(version);
    break;

  case "new":
    run("new.js", args);
    break;
  case "sync":
    run("sync.js");
    break;
  case "check":
    run("check.js", args);
    break;
  case "dev-hint":
    printDevHint(args);
    break;
  case "package":
    run("package-zip.js", args);
    break;

  case "list-views":
    run("contracts.js", ["list-views", ...args]);
    break;

  case "eject-view":
    run("contracts.js", ["eject-view", ...args]);
    break;

  case "accept":
    run("contracts.js", ["accept", ...args]);
    break;

  case "contracts":
    if (args[0] !== "pull") {
      console.error(`${pc.red("✗")} usage: ${pc.cyan("bunx @panomc/theme-core contracts pull")} ${pc.dim("[--from <dir|zip>]")}`);
      process.exit(1);
    }
    run("contracts.js", ["pull", ...args.slice(1)]);
    break;

  default: {
    const hint = suggest(cmd);
    console.error(`${pc.red("✗")} unknown command ${pc.bold(cmd)}`);
    if (hint) console.error(`  did you mean ${pc.cyan(hint)}?`);
    console.error(`  run ${pc.cyan("theme-core help")} to see all commands`);
    process.exit(1);
  }
}
