#!/usr/bin/env bun
/**
 * theme-core CLI — the theme author's single entry point.
 *
 *   bunx theme-core sync           regenerate route shims + host-provides stubs
 *   bunx theme-core eject-view <ViewName>
 *                                  copy a core default view into src/views/ and
 *                                  register it in theme.config.js
 *   bunx theme-core check          contract lint (view registry, svelte pin,
 *                                  settings keys, mandatory slots)
 *   bunx theme-core package        reproducible zip of build/ (the zip sha256
 *                                  is the premium license identity)
 *
 * Scaffolding a NEW theme lives in `bunx @panomc/create-pano-theme` (P4).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const binDir = dirname(fileURLToPath(import.meta.url));
const [cmd, ...args] = process.argv.slice(2);

function run(script, extra = []) {
  const r = spawnSync("bun", [join(binDir, script), ...extra], {
    stdio: "inherit",
    cwd: process.cwd(),
  });
  process.exit(r.status ?? 0);
}

switch (cmd) {
  case "new":
    run("new.js", args);
    break;
  case "sync":
    run("sync.js");
    break;
  case "list-views": {
    const contract = JSON.parse(
      readFileSync(join(binDir, "..", "skin-contract.json"), "utf-8"),
    );
    console.log("Overridable views (theme.config.js → views):\n");
    for (const [name, def] of Object.entries(contract.views)) {
      const props = Object.keys(def.props ?? {});
      console.log(`  ${name.padEnd(26)} props: ${props.join(", ") || "—"}`);
    }
    console.log(
      `\nRegistry components (chrome + plugin-facing):\n  ${contract.registry_components.join(", ")}`,
    );
    console.log(
      "\nEject one with:  bunx theme-core eject-view <ViewName>\n(the file's header documents every prop in detail)",
    );
    break;
  }
  case "check":
    run("check.js", args);
    break;
  case "package":
    run("package-zip.js", args);
    break;
  case "eject-view": {
    const name = args[0];
    if (!name || !/^[A-Z][A-Za-z0-9]*View$/.test(name)) {
      console.error("usage: theme-core eject-view <ViewName>  (e.g. LoginView)");
      process.exit(1);
    }
    const source = join(binDir, "..", "src", "lib", "views", `${name}.svelte`);
    if (!existsSync(source)) {
      console.error(`[theme-core] no default view named '${name}' in this core version`);
      process.exit(1);
    }
    const targetDir = join(process.cwd(), "src", "views");
    const target = join(targetDir, `${name}.svelte`);
    if (existsSync(target)) {
      console.error(`[theme-core] ${target} already exists — refusing to overwrite`);
      process.exit(1);
    }
    mkdirSync(targetDir, { recursive: true });
    copyFileSync(source, target);

    // Register in theme.config.js (idempotent, text-level).
    const configPath = join(process.cwd(), "theme.config.js");
    if (existsSync(configPath)) {
      let cfg = readFileSync(configPath, "utf-8");
      if (!cfg.includes(`${name}:`)) {
        cfg = cfg.replace(
          /views:\s*\{/,
          `views: {\n    ${name}: () => import("./src/views/${name}.svelte"),`,
        );
        writeFileSync(configPath, cfg);
      }
    } else {
      console.warn("[theme-core] no theme.config.js found — register the view manually");
    }
    console.log(`[theme-core] ejected ${name} → src/views/${name}.svelte (registered in theme.config.js)`);
    console.log(`[theme-core] the props contract is documented at the top of the file; 'theme-core check' validates it on every build`);
    break;
  }
  default:
    console.error("usage: theme-core <new|sync|check|list-views|eject-view|package>");
    process.exit(1);
}
