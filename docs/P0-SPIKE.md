# P0 Spike Results — core-as-package build pipeline (2026-07-17)

Goal: prove the `@panomc/theme-core` architecture is buildable under the platform's hard
constraints before extracting anything. **All checks passed. No blockers.**

Spike artifacts lived in the session scratchpad (`spike/core-pkg` + `spike/thin-theme`);
the durable knowledge is this document.

## 1. adapter-node bundles an external core package — PASS

A thin SvelteKit theme depending on `@panomc/theme-core` (file:) with vanilla's config shape
(`ssr.noExternal: true` on build, `preserveSymlinks: true`, `dedupe: ["svelte", ...]`):

- Route shim `+page.js` = `export { load } from "@panomc/theme-core/pages/home"` works.
- `+page.svelte` importing a core `.svelte` view works (SSR + client chunks both contain the
  compiled core component; verified by grepping build output).
- The `build/` output is fully self-contained: copied it to a folder with **no node_modules**
  and booted `PORT=... bun --smol run index.js` (the platform's exact spawn command).
  `/_app/version.json` probe answers; SSR renders core view markup + core `load()` data.

## 2. Byte-reproducible builds — PASS, with one mandatory fix

- **`kit.version.name` MUST be pinned** (e.g. to the package version). SvelteKit defaults it to
  `Date.now()`, which leaks into `/_app/version.json` and env chunks → every build differs.
  vanilla-theme does NOT pin it today, so today's builds are already non-reproducible — this
  must land in vanilla/core regardless of everything else (zip sha256 IS the premium license
  identity; bot rebuilds would otherwise churn license claims).
- With the pin: two consecutive `vite build` runs → `diff -r build-1 build-2` = **zero bytes
  difference** (svelte 5.55.4, kit 2.57.1, vite 8.1.5, adapter-node 5.5.4, bun 1.3.13).

## 3. Deterministic zip — PASS, normalization required

- Naive `zip -r` of two identical trees → **different sha256** (mtimes embedded in zip).
- Normalized zip → **identical sha256**:
  ```sh
  find . -type f -exec touch -t 202601010000.00 {} +
  find . -type f | LC_ALL=C sort | TZ=UTC zip -X -q ../theme.zip -@
  ```
- The future `theme-core` build tool must own the zip step with this normalization
  (stable entry order + fixed mtimes + `-X` no extra fields).

## 4. Runtime shim generation in a thin theme — PASS (with a dev-DX caveat)

- vanilla's `scripts/generate-runtime-shims.js` runs unmodified in the thin theme:
  18 svelte shims + 13 sdk shims + `runtimeShims.js` hash module generated from the
  *installed* package surfaces. Confirms the generator can become a core bin.
- **Caveat:** with a `file:`-symlinked sdk that has no own `node_modules`, `Bun.build`
  resolves imports from the package's real path and fails on `svelte`. Installed-from-npm
  packages (real path inside the consumer's `node_modules`) don't hit this. For local core
  development: run `bun install` inside the core repo, or document `link:` + install.

## 5. Tier-0 launcher (rebuild-free token skins) — FEASIBLE, zero platform changes

Evidence from pano-web-platform (file:line in the feasibility report):

- Themes spawn as `bun --smol run <themes>/<id>/index.js` with cwd = `Pano/`, env:
  `PORT/HOST/API_URL/PANO_WEBSITE_URL/PANO_WEBSITE_API_URL` (+ `PANO_LICENSE_JWT/ISSUER` when
  premium). No `.directory()` override → launcher must use `import.meta.dir`, never
  `process.cwd()`.
- All themes are flat siblings under `themes/`; vanilla is ALWAYS `themes/vanilla-theme`
  (`DEFAULT_THEME_ID`), guaranteed present and auto-upgraded at every boot from the jar-embedded
  zip (hash-diff → delete + re-unzip; `installedBy=SYSTEM`).
- So a Tier-0 `index.js` can resolve vanilla via `import.meta.dir + "/../vanilla-theme"` with
  **zero platform changes**. Optional hardening (1 line in `UIManager.startUI`, using the existing
  `defaultThemeFolder` field): `environment["PANO_SYSTEM_THEME_PATH"] = defaultThemeFolder.absolutePath`.
- Readiness probe (`/_app/version.json`), proxy, and `/lib/<16hex>/` + `/runtime/` cache regexes
  are all HTTP-path-based — no disk assumptions break.
- Premium: fingerprint + whole-zip hash are computed over the **Tier-0 folder/zip only** —
  validates fine while executing vanilla's code. Tier-0 build must ship a valid `fileFingerprint`.
- Watch-outs: Tier-0 id must NOT be `vanilla-theme` (SYSTEM overwrite guard); ship own
  screenshots (panel reads them from the active theme's folder on disk).

## 6. Manifest extensibility — unknown keys ignored, but use a sidecar file

- `ThemeManifest` is Gson-parsed; `@StrictValidation` only enforces *presence* of required keys
  (`id, title, version, author, panoVersion, screenshots`). Unknown keys are **silently
  ignored** — never rejected…
- …but `InstallManager` **rewrites manifest.json** into the `InstalledTheme` shape on install,
  erasing unknown keys. So new metadata (`coreVersion`, `tier`, `baseTheme`) must live in a
  **sidecar file** (e.g. `core-meta.json`): install validation accepts arbitrary extra zip
  entries and never touches them. Note: sidecar IS included in the premium fingerprint —
  fine, since it exists at build time before fingerprinting.
- `panoVersion` confirmed stored/displayed but never enforced (candidate platform-side gate,
  owner decision pending).
- The theme's `licenses.json` is only ever fetched over HTTP from the running theme — never
  parsed from disk; wrong channel for metadata.

## Consequences for the architecture

1. Core exports config factories that pin `kit.version.name` and own zip packaging.
2. Shim generator becomes `theme-core` bin; specifier list defined once.
3. Tier-0 launcher: ~30-line `index.js` using `import.meta.dir`; propose the optional
   `PANO_SYSTEM_THEME_PATH` env var upstream for robustness.
4. New theme metadata goes in `core-meta.json` sidecar, not manifest.json.
5. Local-dev loop for core itself: document `bun install` inside the core repo checkout.
