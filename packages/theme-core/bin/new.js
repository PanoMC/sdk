#!/usr/bin/env bun
/**
 * theme-core new — scaffold a working Pano theme.
 *
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
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const binDir = dirname(fileURLToPath(import.meta.url));
const corePkgDir = join(binDir, "..");
const corePkg = JSON.parse(readFileSync(join(corePkgDir, "package.json"), "utf-8"));
const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("-"));
const local = args.includes("--local") || corePkg.version === "0.0.0-development";

if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error("usage: bunx @panomc/theme-core new <kebab-case-name> [--local]");
  process.exit(1);
}

const dir = resolve(process.cwd(), name);
if (existsSync(dir)) {
  console.error(`[theme-core] ${dir} already exists — refusing to overwrite`);
  process.exit(1);
}

const title = name
  .split("-")
  .map((w) => w[0].toUpperCase() + w.slice(1))
  .join(" ");


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
      author: "CHANGE-ME",
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
          "sass src/styles/style.scss static/style.css --watch --load-path=. --load-path=node_modules --quiet-deps --no-source-map",
        "build:ui":
          "sass src/styles/style.scss static/style.css --load-path=. --load-path=node_modules --quiet-deps --no-source-map",
        sync: "bun node_modules/@panomc/theme-core/bin/sync.js",
        check: "bun node_modules/@panomc/theme-core/bin/check.js",
        prebuild:
          "bun node_modules/@panomc/theme-core/bin/generate-runtime-shims.js && node node_modules/@panomc/theme-core/bin/license/generate-license-constants.js",
        build:
          "vite build && node node_modules/@panomc/theme-core/bin/license/finalize-fingerprint.js",
        package: "bun node_modules/@panomc/theme-core/bin/package-zip.js",
        postinstall:
          "bun node_modules/@panomc/theme-core/bin/bundle-internal-libs.js && bun node_modules/@panomc/theme-core/bin/generate-runtime-shims.js",
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

  ".env": "VITE_API_URL=http://localhost:8088/api\n",

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
bun install
bun run sync     # generate routes / lang / lib bridges
bun run dev      # against a local Pano backend (VITE_API_URL in .env)
bun run check    # contract lint
bun run build && bun run package
\`\`\`

- Tier 1: edit \`src/styles/tokens.scss\`.
- Tier 2: \`bunx @panomc/theme-core eject-view <ViewName>\` (see \`theme-core list-views\`).
`,
};


for (const [rel, content] of Object.entries(FILES)) {
  const target = join(dir, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}
copyFileSync(join(binDir, "templates", "app.html"), join(dir, "src", "app.html"));

console.log(`[theme-core] scaffolded ${name}/ (${Object.keys(FILES).length + 1} files, ${local ? "local workspace links" : `core ^${corePkg.version}`})

Next steps:
  cd ${name}
  bun install          # if it hangs at "Resolving": bun install --backend=copyfile
  bun run sync         # generates src/routes, src/lib bridges, lang/
  bun run dev          # needs a Pano backend (VITE_API_URL in .env)

Make it yours:
  src/styles/tokens.scss           colors / fonts / radius (Tier 1)
  bunx @panomc/theme-core list-views       what you can override
  bunx @panomc/theme-core eject-view HomeView   own a page's markup (Tier 2)`);
