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
bunx @panomc/theme-core sync      # regenerates route shims, refreshes plugin-contracts/;
                                  # new routes materialize, removed ones are swept
bunx @panomc/theme-core check     # lists every contract violation, if any
bun run build             # reproducible zip → republish
```

- **Tier-1 (tokens-only) themes**: the above is the entire migration, including
  across majors.
- **Tier-2 themes**: on majors, fix only the views `check` flags; each core
  major's section below lists the prop changes per view.
- **Plugin view overrides**: a plugin that raised a view's `contract` makes the registry show its default view until you
  update your copy. `bunx @panomc/theme-core eject-view <id>` writes `<file>.new` beside your override; merge it, then
  `bunx @panomc/theme-core accept <id>`. Details in `PLUGIN-VIEWS.md`.
- **Ejected files**: compare against the new default
  (`node_modules/@panomc/theme-core/src/lib/views/…`) manually — they are yours.

This flow is CI-automatable: a renovate-style bump PR that runs
`sync + check + build` and auto-merges on green closes the loop without a
human. Canary order: vanilla → banana → the rest.

## Upgrading a plugin from SDK 1 to SDK 2

SDK 2.0 is final and the only line. A plugin built without `panoSdk 2` is skipped when Pano loads the site UI,
and an item registered with `component` and no `view` is dropped with an error that names the replacement.
Moving takes four steps and no change to the Kotlin side. All official plugins are on SDK 2; none is pending.

1. **Use the preset.** In `rollup.config.js`:

   ```js
   import { panoPlugin } from '@panomc/plugin-kit/rollup';
   export default panoPlugin();
   ```

   If your views are not under `src/theme/views`, add `pano.plugin.js` with `export default { viewDirs: ['src/theme/pages', 'src/theme/components'] };`
   so no file has to move. Add `@panomc/plugin-kit` to `devDependencies`.
2. **Describe pages and injections where the file is.** Wherever a view was registered by hand, put the metadata in the file:

   ```svelte
   <script module>
     export const view = { path: '/store', controller: 'store' };
   </script>
   ```

   A nav item, sidebar widget or hook becomes `export const view = { slot: 'navbar-right', id: 'market-cart' }` (or `hook`,
   `sidebar`). See `PLUGIN-VIEWS.md` for every key.
3. **Replace `component:` with `view:`** in the registrations that remain in code (for example conditional ones). The
   un-named form is gone, not deprecated:

   ```js
   pano.ui.profile.content.edit((items) => [...items, { id: 'market', priority: 50, view: 'market:MarketProfileBlock' }]);
   ```

   The error in the log names each dropped item and the line to write.
4. **Styles.** Keep the look in the view on `<ns>-...` classes. A `<style>` block is fine under the `style-block-scope`
   rule (`PLUGIN-VIEWS.md` section 6).

Then run `bunx pano-plugin check`. A view that imports plugin code which is not a helper, or that uses `getContext`, is
reported with file, line and fix. Until those are fixed, a build with `PANO_VIEW_IMPORTS=warn` turns the errors into warnings;
such a package cannot be ejected by a theme. Logic that views import from stores and `utils` moves to controllers one at a
time, see `CONTROLLERS.md`.

## Version history

### 1.0.0 (unreleased - the extraction)

The engine moved out of vanilla-theme into this package. All five official themes (vanilla, banana, blaze, blocky, frost)
are migrated and depend on `@panomc/theme-core`. The steps below are for a third-party fork of one of them:

1. Branch; add `@panomc/theme-core` + adopt vanilla's `package.json` scripts, config factories, hooks shims,
   `theme.config.js`.
2. Delete `src/lib` (except generated artifacts + `src/pano-sdk`), `src/routes`, `scripts/`; run `theme-core sync`.
3. Move the fork's visual identity into `tokens.scss` (variables) and view overrides (`src/views/` + registry entries) -
   the fork's old page markup adapts to the documented view props.
4. i18n diffs go to `lang-overrides/`.
5. `check` + build + boot smoke.

### Open front-end release (SDK 2)

- Plugin views are named (`market:ProductCard`) and overridable; `theme.config.js` entries may be a function (contract 1)
  or `{ contract, controllers, component }`. Old theme entries keep working; the plugin-side `component` form does not.
- Plugin default views are the vanilla look; vanilla overrides none. A plugin `<style>` block is legal under `style-block-scope`.
- The SDK line is 2.0 and final. The notification and session lists of the core API answer `items` and `page`.
- New `theme.config.js` keys, all optional: `controllers`, `claims`, `routes`, `home`, `provides`.
- New commands: `list-views`, `eject-view`, `accept`, `contracts pull`, `dev-hint`; `check` gained `--strict`, `--fix` and rules C1 to C16.
- `core-meta.json` is written by `sync` and the build; `manifest.json` only gains `apiLevel`.
- The posts feed is also served at `/posts`.
- Default views render the same markup as before.
