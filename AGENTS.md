# AGENTS.md

Entry point for AI coding agents (Claude Code, Codex, Copilot, Gemini …) in `theme-core`. It holds no rules of its own:
open the file that fits your task, and only that one.

| You need                                                              | Read                                            |
| --------------------------------------------------------------------- | ----------------------------------------------- |
| What this repository is, its commands and conventions                 | `REPO-NOTES.md`                                 |
| Rules for every Pano repository: commits, releases, tooling, checks   | `pano-docs/guidelines/common.md`                |
| Plugin, theme or headless front-end work: views, API, classes, tokens | `pano-docs/guidelines/agent-guide/README.md`    |
| How Pano works and is used: platform, addons, themes, API             | `pano-docs/index.md`, then the section you need |

`pano-docs/` is the git submodule [`PanoMC/docs`](https://github.com/PanoMC/docs) (branch `dev`). Empty? Run
`git submodule update --init pano-docs`. Without a checkout the same files are at
`https://github.com/PanoMC/docs/tree/dev`.
