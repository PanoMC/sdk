# Repository notes

Notes for agents and people working in this repository. `AGENTS.md` routes here.


## What this is

`theme-core` (GitHub: `PanoMC/sdk`) is the front-end engine of Pano: a Bun workspace of six packages. Themes, plugins,
panel-ui, setup-ui and headless sites consume it; most of them take it as a git submodule or a `file:` dependency until
the packages are on npm.

| Package | What it is |
| --- | --- |
| `packages/theme-core` | the theme engine: hooks factories, plugin engine, view registry, default views, generated routes, and the `theme-core` CLI (`bin/`: `new`, `sync`, `check`, `list-views`, `eject-view`, `accept`, `contracts pull`, `dev-hint`, `package`) |
| `packages/sdk` | `@panomc/sdk` 2: what plugin and theme code imports (components, controllers wrapper, utils), plus the `pano-api` tool (`bin/api/`) |
| `packages/plugin-kit` | the plugin build: `panoPlugin()` rollup preset, the `pano-plugin` CLI (`dev`, `build`, `check`, `classes`, `new`, `samples`), the controller core, the plugin template (`bin/templates/plugin/`) |
| `packages/client` | `@panomc/client`: typed JavaScript client of the Pano HTTP API, no framework |
| `packages/client-gen` | the `pano-client` generator (`generate`, `pull`, `check`, `new`) and the headless scaffold |
| `packages/widget-host` | runtime that runs plugin views as web components outside a theme |

Also here: `docs/` (the author docs for people), `pano-docs/` (git submodule `PanoMC/docs`: the rules for agents
are in `pano-docs/guidelines/agent-guide/`, changed only in that repo),
`test-fixtures/`, `scripts/`.

## Commands

```bash
bun install
bun scripts/test-each.js                    # every *.test.js in its own process
bun scripts/test-each.js plugin-kit check   # only files whose path contains one of the filters
bun docs/check-links.mjs                    # paths, commands, flags and exports quoted in docs/ and the agent guide (pano-docs/)
```

Do not run a bare `bun test` at the root: `mock.module` leaks between files that share a process. CI runs
`bun test packages`; locally use `scripts/test-each.js`.

## Conventions

- JavaScript with JSDoc only; no TypeScript sources (`typescript` is installed for type checking of JSDoc).
- Default views must render the same markup as before unless a change is announced as `visual:`; a contract change of an
  engine view is a major (`docs/MIGRATION.md`).
- A CLI command, flag or rule you add or rename: update `docs/` here and `guidelines/agent-guide/` in `PanoMC/docs`;
  `docs/check-links.mjs` fails on a quoted command or flag that does not exist.
- Port engine changes to the five themes: `theme-core sync` + `check` in each.
- Releases are made by semantic-release from one-line conventional commits; never bump a version by hand
  (`scripts/set-version.js` is for CI).

## Changing a default view or engine component

The markup in `packages/theme-core/src/lib/` (views, parts, components) is a contract: themes and plugins style it
and override it. When you change it:

- Keep every `pano-*` semantic class (the root class and the `__part` classes), every `<PluginSlot>`, `<Hook>` and
  prop. Add Bootstrap classes next to them; never replace or drop one. `pano-plugin classes --fix` restores a missing
  root class, and `engineStyles.test.js` fails on one.
- Regenerate what is built from the markup, and commit it with the change:
  `node packages/theme-core/bin/generate-contract.js` (skin-contract.json, engine-views.generated.js) and
  `bun scripts/build-tokens.js` (the fallback CSS, when you use a Bootstrap class the engine did not use before).
- Update the render snapshots (`src/lib/__tests__/fixtures/*.ssr.json`) only for the cases you changed on purpose,
  and say in the commit that the look changed (see the `visual:` rule above).
- A `<style>` block with `:global(...)` in a view is lint debt: prefer a class, or record it in `engineStyles.test.js`.
- Run `bun scripts/test-each.js` before you push, and do not push on top of a red CI run on `dev`: fix it first.
- Commit messages are one line in conventional form (`fix:`, `feat:`, `chore:` …), written for the person who updates
  Pano: they become the changelog. Never "Refactor code structure" or an AI tool's default message.
