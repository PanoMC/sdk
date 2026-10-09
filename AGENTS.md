# AGENTS.md

Guidance for AI coding agents working in this repository (`CLAUDE.md` carries the same text).

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

Also here: `docs/` (the author docs for people), `agent-guide/` (the rules for agents, synced into the other repos),
`test-fixtures/`, `scripts/`.

## Commands

```bash
bun install
bun scripts/test-each.js                    # every *.test.js in its own process
bun scripts/test-each.js plugin-kit check   # only files whose path contains one of the filters
bun docs/check-links.mjs                    # paths, commands, flags and exports quoted in docs/ and agent-guide/
bun scripts/sync-agent-guide.js             # copy agent-guide/ into the consumer repos, rewrite their pointer blocks
bun scripts/sync-agent-guide.js --check     # exit 1 when a copy or a pointer block is stale
```

Do not run a bare `bun test` at the root: `mock.module` leaks between files that share a process. CI runs
`bun test packages`; locally use `scripts/test-each.js`.

## Conventions

- JavaScript with JSDoc only; no TypeScript sources (`typescript` is installed for type checking of JSDoc).
- Default views must render the same markup as before unless a change is announced as `visual:`; a contract change of an
  engine view is a major (`docs/MIGRATION.md`).
- A CLI command, flag or rule you add or rename: update `docs/` and `agent-guide/` in the same commit;
  `docs/check-links.mjs` fails on a quoted command or flag that does not exist.
- Port engine changes to the five themes: `theme-core sync` + `check` in each.
- Releases are made by semantic-release from one-line conventional commits; never bump a version by hand
  (`scripts/set-version.js` is for CI).

<!-- pano-agent-guide:start -->
## Agent guide

You are in **theme-core** (repo `PanoMC/sdk`): the theme engine, the SDK, the plugin kit and the client packages. The agent guide is edited HERE, in `agent-guide/`.

Read `agent-guide/README.md` for the rules themes, plugins and headless front-ends follow. When a change here alters
one of those rules, a command or a flag, update the topic file in the same commit, then run
`bun docs/check-links.mjs` and `bun scripts/sync-agent-guide.js` (the copies in the other repos are committed there).

The three rules you will break first:

1. A rule in the guide must be true in the code: change both together, never the guide alone.
2. Run tests per file with `bun scripts/test-each.js [filter]`, not a bare `bun test` at the root.
3. JavaScript with JSDoc only; every engine change is ported to the themes with `theme-core sync` + `check`.
<!-- pano-agent-guide:end -->
