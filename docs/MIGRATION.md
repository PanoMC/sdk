# MIGRATION.md — core version bumps

## Semver policy

- **Patch**: bug fixes, no contract change. Bump + rebuild, nothing else.
- **Minor**: additive — new routes, new view-slot ids, new settings keys, new
  controller props, new i18n keys, **and visual changes to default views**
  (flagged `visual:` in the changelog; pin core if you need a frozen look).
  Un-overridden themes pick everything up automatically; overridden views keep
  working because props are only added, never changed or removed.
- **Major**: a controller-props shape changed, a view/slot/lifecycle name was
  removed, or the pinned svelte version jumped (which is simultaneously a
  plugin-ecosystem event — installed plugin builds compile against the host
  runtime surface).

## Upgrading a theme

```sh
bun update @panomc/theme-core
bunx theme-core sync      # regenerates route shims; new routes materialize,
                          # removed ones are swept (ejected files untouched)
bunx theme-core check     # lists every contract violation, if any
bun run build             # reproducible zip → republish
```

- **Tier-1 (tokens-only) themes**: the above is the entire migration, including
  across majors.
- **Tier-2 themes**: on majors, fix only the views `check` flags; each core
  major's section below lists the prop changes per view.
- **Ejected files**: compare against the new default
  (`node_modules/@panomc/theme-core/src/lib/views/…`) manually — they are yours.

This flow is CI-automatable: a renovate-style bump PR that runs
`sync + check + build` and auto-merges on green closes the loop without a
human. Canary order: vanilla → banana → the rest.

## Version history

### 1.0.0 (unreleased — the extraction)

The engine moved out of vanilla-theme into this package. One-time migration for
existing forks (banana done as pilot; blaze/blocky/frost pending):

1. Branch; add `@panomc/theme-core` + adopt vanilla-thin's `package.json`
   scripts, config factories, hooks shims, `theme.config.js`.
2. Delete `src/lib` (except generated artifacts + `src/pano-sdk`), `src/routes`,
   `scripts/`; run `theme-core sync`.
3. Move the fork's visual identity into `tokens.scss` (variables) and view
   overrides (`src/views/` + registry entries) — the fork's old page markup
   adapts to the documented view props.
4. i18n diffs → `lang-overrides/`.
5. `check` + build + boot smoke.
