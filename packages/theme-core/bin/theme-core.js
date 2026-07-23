#!/usr/bin/env bun
/**
 * theme-core CLI — the theme author's single entry point.
 *
 *   bunx @panomc/theme-core new [name]     scaffold a working Pano theme
 *   bunx @panomc/theme-core sync           regenerate route shims + host-provides stubs
 *   bunx @panomc/theme-core check          contract lint (view registry, svelte pin, …)
 *   bunx @panomc/theme-core list-views     list the overridable core views
 *   bunx @panomc/theme-core eject-view <ViewName>
 *                                  copy a core default view into src/views/ and
 *                                  register it in theme.config.js
 *   bunx @panomc/theme-core package        reproducible zip of build/ (the zip sha256
 *                                  is the premium license identity)
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pc, version, DOCS_URL, brandIntro, outro, note } from "./ui.js";

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
  check: "contract lint — view registry, svelte pin, slots, settings",
  "list-views": "list the core views you can override",
  "eject-view": "copy a default view into src/views/ and register it",
  package: "reproducible zip of build/ (its sha256 is the license identity)",
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
    const arg = name === "eject-view" ? pc.dim(" <View>") : "";
    lines.push(`  ${pc.yellow(name.padEnd(pad))}${arg}  ${pc.dim(desc)}`);
  }
  lines.push(
    "",
    pc.bold("Examples"),
    `  ${pc.cyan("bunx @panomc/theme-core new")}              ${pc.dim("interactive scaffolder")}`,
    `  ${pc.cyan("bunx @panomc/theme-core new my-theme")}     ${pc.dim("scaffold immediately")}`,
    `  ${pc.cyan("bunx @panomc/theme-core eject-view LoginView")}`,
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
  case "package":
    run("package-zip.js", args);
    break;

  case "list-views": {
    const contract = JSON.parse(
      readFileSync(join(binDir, "..", "skin-contract.json"), "utf-8"),
    );
    console.log(
      `\n${pc.bgCyan(pc.black(" pano "))} ${pc.bold("theme-core")} ${pc.dim(`v${version}`)}`,
    );
    // Wrap the (sometimes long) props list under an indented tree so the
    // output stays readable instead of running one giant line per view.
    const width = Math.min(process.stdout.columns || 80, 100);
    const indent = "     ";
    const wrap = (items) => {
      const lines = [];
      let line = "";
      for (const item of items) {
        const chunk = line ? `${line}, ${item}` : item;
        if (indent.length + chunk.length > width && line) {
          lines.push(indent + line + ",");
          line = item;
        } else {
          line = chunk;
        }
      }
      if (line) lines.push(indent + line);
      return lines;
    };
    console.log(pc.bold("\n  Overridable views ") + pc.dim("(theme.config.js → views)\n"));
    for (const [name, def] of Object.entries(contract.views)) {
      const props = Object.keys(def.props ?? {});
      console.log(`  ${pc.cyan("●")} ${pc.bold(name)}`);
      if (props.length) for (const l of wrap(props)) console.log(pc.dim(l));
      else console.log(indent + pc.dim("(no props)"));
    }
    console.log(pc.bold("\n  Registry components ") + pc.dim("(chrome + plugin-facing)"));
    for (const l of wrap(contract.registry_components)) console.log(pc.dim(l));
    console.log(
      `\n  Eject one with ${pc.cyan("bunx @panomc/theme-core eject-view <ViewName>")}` +
        `\n  ${pc.dim("(the file's header documents every prop in detail)")}\n`,
    );
    break;
  }

  case "eject-view": {
    const name = args[0];
    if (!name || !/^[A-Z][A-Za-z0-9]*View$/.test(name)) {
      console.error(
        `${pc.red("✗")} usage: ${pc.cyan("bunx @panomc/theme-core eject-view <ViewName>")} ${pc.dim("(e.g. LoginView)")}`,
      );
      process.exit(1);
    }
    const source = join(binDir, "..", "src", "lib", "views", `${name}.svelte`);
    if (!existsSync(source)) {
      console.error(`${pc.red("✗")} no default view named ${pc.bold(name)} in this core version`);
      process.exit(1);
    }
    const targetDir = join(process.cwd(), "src", "views");
    const target = join(targetDir, `${name}.svelte`);
    if (existsSync(target)) {
      console.error(`${pc.red("✗")} ${target} already exists — refusing to overwrite`);
      process.exit(1);
    }
    mkdirSync(targetDir, { recursive: true });
    copyFileSync(source, target);

    // Register in theme.config.js (idempotent, text-level).
    const configPath = join(process.cwd(), "theme.config.js");
    let registered = false;
    if (existsSync(configPath)) {
      let cfg = readFileSync(configPath, "utf-8");
      if (!cfg.includes(`${name}:`)) {
        cfg = cfg.replace(
          /views:\s*\{/,
          `views: {\n    ${name}: () => import("./src/views/${name}.svelte"),`,
        );
        writeFileSync(configPath, cfg);
      }
      registered = true;
    }

    brandIntro();
    note(
      [
        `${pc.green("✓")} copied to ${pc.cyan(`src/views/${name}.svelte`)}`,
        registered
          ? `${pc.green("✓")} registered in ${pc.cyan("theme.config.js")}`
          : `${pc.yellow("▲")} no theme.config.js found — register the view manually`,
      ].join("\n"),
      `Ejected ${name}`,
    );
    outro(
      [
        "Next steps:",
        `  ${pc.dim("edit")}  ${pc.cyan(`src/views/${name}.svelte`)} ${pc.dim("(props are documented in its header)")}`,
        `  ${pc.dim("run")}   ${pc.cyan("bun run check")} ${pc.dim("to validate the override contract")}`,
      ].join("\n"),
    );
    break;
  }

  default: {
    const hint = suggest(cmd);
    console.error(`${pc.red("✗")} unknown command ${pc.bold(cmd)}`);
    if (hint) console.error(`  did you mean ${pc.cyan(hint)}?`);
    console.error(`  run ${pc.cyan("theme-core help")} to see all commands`);
    process.exit(1);
  }
}
