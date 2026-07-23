#!/usr/bin/env bun
/**
 * theme-core new — scaffold a working Pano theme.
 *
 *   bunx @panomc/theme-core new                     interactive wizard (TTY only)
 *   bunx @panomc/theme-core new my-theme            npm-published core (default)
 *   bunx @panomc/theme-core new my-theme --local    file: links into a local theme-core
 *                                           checkout (this workspace)
 *
 * The result runs immediately and looks like vanilla; the author's job starts
 * at src/styles/tokens.scss (Tier 1) and grows through eject-view (Tier 2).
 * vanilla-theme itself is NOT a template: its id is reserved for the SYSTEM
 * theme and it carries repo-specific baggage — this scaffolder is the entry.
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  pc,
  isInteractive,
  cancelGuard,
  brandIntro,
  text,
  confirm,
  spinner,
  outro,
  note,
  DOCS_URL,
} from "./ui.js";

const binDir = dirname(fileURLToPath(import.meta.url));
const corePkgDir = join(binDir, "..");
const corePkg = JSON.parse(readFileSync(join(corePkgDir, "package.json"), "utf-8"));
const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const nameArg = args.find((a) => !a.startsWith("-"));
const local = args.includes("--local") || corePkg.version === "0.0.0-development";

const KEBAB = /^[a-z][a-z0-9-]*$/;
const titleFrom = (name) =>
  name
    .split("-")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

// ---- resolve inputs ---------------------------------------------------------
// Prompt for EVERYTHING before a single file is written, so a Ctrl+C never
// leaves a half-created theme on disk.
let name, dir, title, author, doInstall;
const interactive = isInteractive() && !nameArg;

if (interactive) {
  brandIntro();

  const where = cancelGuard(
    await text({
      message: "Where should we create your theme?",
      placeholder: "./my-theme",
      defaultValue: "./my-theme",
      validate(value) {
        const v = (value || "./my-theme").trim();
        const base = basename(resolve(process.cwd(), v));
        if (!KEBAB.test(base))
          return "The folder name must be kebab-case (a-z, 0-9, dashes).";
        if (existsSync(resolve(process.cwd(), v)))
          return `${v} already exists — pick a path that doesn't exist yet.`;
      },
    }),
  );
  const rel = (where || "./my-theme").trim();
  dir = resolve(process.cwd(), rel);
  name = basename(dir);

  title = cancelGuard(
    await text({
      message: "Theme title?",
      placeholder: titleFrom(name),
      defaultValue: titleFrom(name),
    }),
  );
  title = (title || titleFrom(name)).trim();

  author = cancelGuard(
    await text({
      message: "Author?",
      placeholder: "CHANGE-ME",
      defaultValue: "CHANGE-ME",
    }),
  );
  author = (author || "CHANGE-ME").trim() || "CHANGE-ME";

  doInstall = cancelGuard(
    await confirm({
      message: "Install dependencies with bun now?",
      initialValue: true,
    }),
  );
} else {
  // Non-interactive: a name argument is mandatory. No prompts, no install.
  if (!nameArg || !KEBAB.test(nameArg)) {
    if (!nameArg && !process.stdout.isTTY) {
      console.error(
        `${pc.red("✗")} a theme name is required in non-interactive mode\n  usage: ${pc.cyan("bunx @panomc/theme-core new <kebab-case-name> [--local]")}\n  ${pc.dim("(run it in a terminal with no name for the interactive wizard)")}`,
      );
    } else {
      console.error(
        `${pc.red("✗")} usage: ${pc.cyan("bunx @panomc/theme-core new <kebab-case-name> [--local]")}`,
      );
    }
    process.exit(1);
  }
  name = nameArg;
  dir = resolve(process.cwd(), name);
  if (existsSync(dir)) {
    console.error(`${pc.red("✗")} ${dir} already exists — refusing to overwrite`);
    process.exit(1);
  }
  title = titleFrom(name);
  author = "CHANGE-ME";
  doInstall = false;
}

// ---- dependency sources -----------------------------------------------------
// Local mode links straight into the workspace checkout so the scaffold works
// before the packages exist on npm; published mode uses semver ranges.
let coreDep = `^${corePkg.version}`;
let sdkDep = `^${corePkg.version}`;
if (local) {
  const sdkDir = dirname(require.resolve("@panomc/sdk/package.json"));
  coreDep = `file:${corePkgDir}`;
  sdkDep = `file:${sdkDir}`;
}

// ---- token reference --------------------------------------------------------
// Enumerate every !default variable from the engine SCSS so tokens.scss ships
// as a commented, self-documenting menu instead of a blank file.
function collectTokens() {
  const lines = [];
  try {
    const sdkDir = dirname(require.resolve("@panomc/sdk/package.json"));
    for (const [file, label] of [
      ["core/scss/custom-bootstrap.scss", "Colors, radius, typography (Bootstrap layer)"],
      ["core/scss/themes.scss", "Named dark themes"],
    ]) {
      const src = readFileSync(join(sdkDir, file), "utf-8");
      const vars = [...src.matchAll(/^\$([\w-]+)\s*:\s*([^;]*?)\s*!default;/gm)]
        .filter(([, , value]) => !value.includes("\n"));
      if (vars.length) {
        lines.push(`// ── ${label} ${"─".repeat(Math.max(3, 46 - label.length))}`);
        for (const [, varName, value] of vars) lines.push(`// $${varName}: ${value};`);
        lines.push("");
      }
    }
  } catch {
    lines.push(
      "// (token list unavailable at scaffold time — see",
      "//  node_modules/@panomc/sdk/core/scss/custom-bootstrap.scss for every variable)",
      "",
    );
  }
  return lines.join("\n");
}

// ---- files ------------------------------------------------------------------
const FILES = {
  "manifest.json": JSON.stringify(
    {
      id: name,
      title,
      version: "1.0.0",
      author,
      description: `${title} theme for Pano`,
      panoVersion: "1.0.0",
      screenshots: [],
      premium: false,
    },
    null,
    2,
  ) + "\n",

  "core-meta.json": "{}\n",

  "theme.config.js": `/**
 * ${title} — thin theme on @panomc/theme-core.
 *
 * Tier 1: edit src/styles/tokens.scss and ship — this file stays empty.
 * Tier 2: eject a view, register it here:
 *   bunx @panomc/theme-core eject-view LoginView
 * Extra settings your views edit are declared in settingsSchema (see the
 * theme-core author guide).
 */
export default {
  views: {},
};
`,

  "package.json": JSON.stringify(
    {
      name: `pano-${name}`,
      version: "1.0.0",
      type: "module",
      scripts: {
        dev: "vite dev --host=0.0.0.0 --port 3000",
        "dev:ui": 'concurrently "bun run watch:ui" "bun run dev"',
        "watch:ui":
          "sass src/styles/style.scss static/style.css --watch --load-path=. --load-path=node_modules --quiet-deps --silence-deprecation=import --no-source-map",
        "build:ui":
          "sass src/styles/style.scss static/style.css --load-path=. --load-path=node_modules --quiet-deps --silence-deprecation=import --no-source-map",
        sync: "bun node_modules/@panomc/theme-core/bin/sync.js",
        check: "bun node_modules/@panomc/theme-core/bin/check.js",
        prebuild:
          "bun node_modules/@panomc/theme-core/bin/generate-runtime-shims.js && node node_modules/@panomc/theme-core/bin/license/generate-license-constants.js",
        build:
          "vite build && node node_modules/@panomc/theme-core/bin/license/finalize-fingerprint.js",
        package: "bun node_modules/@panomc/theme-core/bin/package-zip.js",
        postinstall:
          "bun node_modules/@panomc/theme-core/bin/bundle-internal-libs.js && bun node_modules/@panomc/theme-core/bin/generate-runtime-shims.js && bun node_modules/@panomc/theme-core/bin/sync.js && node node_modules/@panomc/theme-core/bin/license/generate-license-constants.js",
      },
      devDependencies: {
        "@fortawesome/fontawesome-free": "^6.7.2",
        "@panomc/sdk": sdkDep,
        "animate.css": "^4.1.1",
        "@panomc/theme-core": coreDep,
        "@sveltejs/adapter-node": corePkg.peerDependencies["@sveltejs/adapter-node"],
        "@sveltejs/kit": corePkg.peerDependencies["@sveltejs/kit"],
        "@sveltejs/vite-plugin-svelte": corePkg.peerDependencies["@sveltejs/vite-plugin-svelte"],
        bootstrap: "^5.3.8",
        concurrently: "^9.2.1",
        sass: corePkg.peerDependencies["sass"],
        svelte: corePkg.dependencies.svelte,
        "svelte-i18n": corePkg.peerDependencies["svelte-i18n"],
        "svelte-preprocess": corePkg.peerDependencies["svelte-preprocess"],
        vite: corePkg.peerDependencies["vite"],
      },
      trustedDependencies: ["@parcel/watcher", "es5-ext", "esbuild", "svelte-preprocess"],
    },
    null,
    2,
  ) + "\n",

  "svelte.config.js": `import { createSvelteConfig } from "@panomc/theme-core/kit/svelte-config";

export default await createSvelteConfig(import.meta.url);
`,

  "vite.config.js": `import { createViteConfig } from "@panomc/theme-core/kit/vite-config";

export default createViteConfig();
`,

  ".env": "# Your running Pano API address (--dev port is 8088; default install is port 80)\n"
    + "VITE_API_URL=http://localhost:8088/api\n\n"
    + "# Must match the Pano backend cookie prefix (leave as-is unless you changed it there)\n"
    + "VITE_COOKIE_PREFIX=pano_\n\n"
    + "VITE_UI_URL=/\nVITE_PANEL_URL=/panel\nVITE_SETUP_URL=/\n",

  ".gitignore": `node_modules/
build/
.svelte-kit/
.claude/
.idea
.vscode
.DS_Store

# runtime artifacts — regenerated, never hand-edited
plugins/
static/runtime/
static/lib/
static/assets/
src/lib/server/license-constants.generated.js
`,

  "src/hooks.server.js": `import { createThemeHooks } from "$pano/kit/hooks-server.js";
import { internalLibsHash } from "$lib/internalLibs.js";
import { runtimeShimsHash } from "$lib/runtimeShims.js";
import * as licenseConstants from "$lib/server/license-constants.generated.js";

export const { handle, handleError, handleFetch } = createThemeHooks({
  internalLibsHash,
  runtimeShimsHash,
  licenseConstants,
});
`,

  "src/hooks.client.js": `import {
  installRuntimeRegistry,
  createClientInit,
} from "$pano/kit/hooks-client.js";

installRuntimeRegistry();

export const init = createClientInit();
`,

  "src/styles/tokens.scss": `// Design tokens — imported FIRST by style.scss, so anything you set here
// overrides the engine's defaults (every variable below is declared !default
// in the engine).
//
// Uncomment a line and change its value; that alone produces a visibly
// different theme.

${collectTokens()}`,

  "src/styles/style.scss": `// Design tokens first: everything in tokens.scss overrides the engine's
// !default variables below.

@import "tokens";

// The engine's stylesheet (Bootstrap + Pano behavior styles), resolved from
// node_modules via the sass load path.

@import "node_modules/@panomc/sdk/core/scss/main";
@import "node_modules/tippy.js/dist/tippy";
@import "node_modules/animate.css/animate.min";

@import "node_modules/@fortawesome/fontawesome-free/scss/fontawesome";
@import "node_modules/@fortawesome/fontawesome-free/scss/brands";
@import "node_modules/@fortawesome/fontawesome-free/scss/solid";

// ${title}'s own styles go below.
`,

  "src/styles/_empty.scss": "// dev-mode placeholder for the @theme-style alias\n",

  "lang-overrides/.gitkeep": "",
  "screenshots/.gitkeep": "",

  "README.md": `# ${title}

A Pano theme built on [@panomc/theme-core](https://github.com/PanoMC/sdk).

\`\`\`sh
bun install      # also generates routes / lang / lib bridges
bun run dev:ui   # against a local Pano backend (VITE_API_URL in .env)
bun run check    # contract lint
bun run build && bun run package
\`\`\`

- Tier 1: edit \`src/styles/tokens.scss\`.
- Tier 2: \`bunx @panomc/theme-core eject-view <ViewName>\` (see \`theme-core list-views\`).
`,
};

// ---- scaffold ---------------------------------------------------------------
function scaffold() {
  for (const [rel, content] of Object.entries(FILES)) {
    const target = join(dir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  copyFileSync(join(binDir, "templates", "app.html"), join(dir, "src", "app.html"));
  return Object.keys(FILES).length + 1;
}

const depLabel = local ? "local workspace links" : `core ^${corePkg.version}`;

if (interactive) {
  const s = spinner();
  s.start(`Scaffolding ${name}…`);
  const count = scaffold();
  s.stop(`Scaffolded ${count} files ${pc.dim(`(${depLabel})`)}`);

  if (doInstall) {
    const s2 = spinner();
    s2.start("Installing dependencies (bun install)…");
    const r = spawnSync("bun", ["install", "--backend=copyfile"], {
      cwd: dir,
      stdio: "ignore",
    });
    if (r.status === 0) {
      s2.stop("Installed dependencies");
    } else {
      s2.stop(`${pc.yellow("▲")} bun install did not complete — run it yourself`);
      note(
        `${pc.dim("cd")} ${name}\n${pc.dim("run")} ${pc.cyan("bun install --backend=copyfile")}`,
        "Finish setup manually",
      );
    }
  }

  outro(
    [
      pc.bold("Your theme is ready!"),
      "",
      "Next steps:",
      `  ${pc.cyan(`cd ${name}`)}`,
      doInstall ? null : `  ${pc.cyan("bun install --backend=copyfile")}`,
      `  ${pc.cyan("bun run dev:ui")}`,
      "",
      `Then browse through your Pano's address ${pc.dim("(e.g. http://localhost:8088)")}.`,
      `Docs: ${pc.cyan(DOCS_URL)}`,
    ]
      .filter((l) => l !== null)
      .join("\n"),
  );
} else {
  const count = scaffold();
  console.log(
    [
      `${pc.green("✓")} scaffolded ${pc.bold(`${name}/`)} ${pc.dim(`(${count} files, ${depLabel})`)}`,
      "",
      pc.bold("Next steps:"),
      `  ${pc.cyan(`cd ${name}`)}`,
      `  ${pc.cyan("bun install")}          ${pc.dim('# also generates routes/lang/bridges; if it hangs: bun install --backend=copyfile')}`,
      `  ${pc.cyan("bun run dev:ui")}       ${pc.dim("# needs a Pano backend (VITE_API_URL in .env)")}`,
      "",
      pc.bold("Make it yours:"),
      `  ${pc.cyan("src/styles/tokens.scss")}                    ${pc.dim("colors / fonts / radius (Tier 1)")}`,
      `  ${pc.cyan("bunx @panomc/theme-core list-views")}        ${pc.dim("what you can override")}`,
      `  ${pc.cyan("bunx @panomc/theme-core eject-view HomeView")} ${pc.dim("own a page's markup (Tier 2)")}`,
    ].join("\n"),
  );
}
