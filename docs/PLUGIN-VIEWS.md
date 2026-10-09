# Plugin views

A plugin's site UI is a set of named views. Every view can be redrawn by a theme, and nothing a theme does can break a
plugin update. This page follows a view from the plugin author's file to the theme's override and back to the fallback.
Logic that is not markup lives in controllers: see `CONTROLLERS.md`.

## 1. Names

A view is one `.svelte` file. Its name is the file name, its id is `<ns>:<Name>`.

| Thing | Rule | Example |
|---|---|---|
| Namespace `ns` | the plugin id without a leading `pano-plugin-`; nothing else is stripped | `pano-plugin-market` gives `market` |
| Own namespace | `namespace` in `pano.plugin.js` | `export default { namespace: 'shop' }` |
| View id | `<ns>:<Name>`, `Name` matches `[A-Z][A-Za-z0-9]*` | `market:ProductCard` |
| Engine view | the bare name | `Navbar` |
| Slot a plugin opens | `<ns>:<slot>`, lowercase, colons and dashes | `market:checkout:payment` |

The full id works as an alias (`pano-plugin-market:ProductCard`). The words `theme`, `page`, `pano`, `core`, `route`,
`home` and `block` cannot be a namespace. If two plugins end up with the same namespace, the second plugin keeps running
but its site UI is left out and the panel shows `NAMESPACE_CLASH`. Nothing is renamed; the fix is one `namespace` line.

Views are the `.svelte` files under `viewDirs` (default `src/theme/views`, set in `pano.plugin.js`).

## 2. What a view declares

Everything about a view sits in that file. There is no registration code.

```svelte
<!-- src/theme/views/HelloPage.svelte  ->  view "hello:HelloPage", page /hello -->
<script module>
  export const view = { path: '/hello' };
</script>
<h1>Hello</h1>
```

`view` is optional and holds literals only (it is parsed, never run). Props are read from `$props()`.

| Key | Meaning | Default |
|---|---|---|
| `contract` | integer contract version (section 3) | `1` |
| `path`, `systemLayout`, `layout`, `permission`, `loginRequired`, `resetLayout` | registers a page | not a page |
| `controller` | for a page: its `load` comes from this controller (`CONTROLLERS.md`) | none |
| `slot`, `hook`, `sidebar` (string or list), `id`, `priority`, `skipLoad` | mounts the view by itself in a slot, hook or sidebar; `id` defaults to the view id | none |
| `block` | `true` = made for `<PluginBlock>` (section 5); its `load` runs once per placement | `false` |
| `home` | `{ label }`: offer this page as a home page option | none |
| `widget` | a web component, see the widget docs of the client packages | none |

Rules the build enforces for every plugin, each error names file, line and fix:

- A view imports only `svelte*`, `svelte-i18n`, `@panomc/sdk*`, other views and view helpers (relative `.js` files outside
  `src/theme/controllers/`). Helpers ship as readable source; controllers are compiled and closed.
- A view does not call `setContext`, `getContext` or `hasContext`. On the server a plugin view runs in its own copy of
  Svelte, so take the value as a prop or read host data through `@panomc/sdk`.
- No duplicate file names, no non-literal `view`, no slot id outside the plugin's own namespace.

## 3. Contract version and lock

The contract of a view is its props, its slots and its hooks. `contract` is the version a theme override is written
against. The build writes `pano-plugin.lock.json` (commit it). When a prop is removed, a required prop is added, or
`slots` or `hooks` change without a higher `contract`, then:

- `bun run dev` prints one warning line and goes on;
- `bun run build` fails with the line to change: `market:ProductCard: prop "settings" removed - set contract: 3 in ProductCard.svelte`.

A new optional prop only updates the lock. Never published yet? Delete the lock and build again.

The build also writes `contract/views.json` and a readable copy of every view into `contract/src/` inside the plugin
package. A theme reads those to redraw a view.

## 4. Overrides in a theme

A theme replaces a plugin view with one command and then edits the file:

```sh
bunx @panomc/theme-core eject-view market:ProductCard
bunx @panomc/theme-core eject-view 'market:*' --pages
```

`component` in this entry is the theme's own override, written by `eject-view`. It is not the plugin-side registration
form of SDK 1, which is gone (`MIGRATION.md`).

The command copies the readable source to `src/views/market/ProductCard.svelte`, removes `load` and `view` from it, rewrites
imports of other views to `pluginView("market:PriceTag")`, copies the view helpers it needs to `src/views/market/_lib/`
and writes the entry in `theme.config.js`:

```js
views: {
  Navbar: () => import("./src/views/Navbar.svelte"),              // a plain function is contract 1
  "market:ProductCard": {
    contract: 2,
    controllers: ["market/cart", "market/format"],
    component: () => import("./src/views/market/ProductCard.svelte"),
  },
},
```

Other commands:

```sh
bunx @panomc/theme-core contracts pull          # copy plugin contracts into plugin-contracts/
bunx @panomc/theme-core list-views              # engine and plugin views, contract, overridden marks
bunx @panomc/theme-core accept market:ProductCard
```

`plugin-contracts/<ns>/` holds the contract without the sources, so a paid plugin's source never enters a theme repo.
`sync` and every dev start refresh it. A plugin built with `PANO_VIEW_IMPORTS=warn` (migration mode) cannot be ejected;
update the plugin.

Data always comes from the plugin: pages, injections and blocks keep the plugin's own `load`, the override supplies markup
only. A `load` exported by an override is ignored (`check` warns). A theme can still use any controller, see
`CONTROLLERS.md`.

## 5. Blocks, claims and slots

**Blocks.** A theme places a view with `<PluginBlock>`. The data is loaded per placement, on the server, so two grids with
different props get two data sets. Props must be literals for that.

```svelte
<script>
  import { PluginBlock } from "@panomc/sdk/components/theme";
</script>
<PluginBlock id="market:GoalWidget" />
<PluginBlock id="market:NavCart" />
```

Block ids of the official plugins are listed in section 8. A block that takes props gets them as literals, for example
`<PluginBlock id="comments:ThemePostComments" />` (a block that reads its own page data keeps working the same way).

An unknown id or a missing plugin renders nothing (or the `fallback` snippet).

**Claims.** A nav item, sidebar widget or hook that a plugin mounts by itself is an injection. When a theme places that
view itself with `<PluginBlock id="market:NavCart" />` (it mounts itself in `navbar-right`), the automatic copy disappears: the theme has claimed it.
`theme.config.js` can set it by hand; an explicit entry wins, and `false` keeps the automatic copy:

```js
claims: { "market:NavCart": true, "market:CartOffcanvas": false },
```

**Slots.** A plugin view can open a slot for other plugins:

```svelte
<script>
  import { PluginSlot } from "@panomc/sdk/components/theme";
</script>
<PluginSlot id="market:checkout:payment" props={{ order, method }} filter={(item) => item.id === method} />
```

`market:CheckoutPage` opens `market:checkout:payment` and `market:checkout:shipping` like this.

Another plugin fills it with `export const view = { slot: "market:checkout:payment", id: "stripe", priority: 10 }`. An
override of the host view must keep every `<PluginSlot>` of the default (check rule C4).

## 6. Styling a plugin view

A plugin's default views are the look of vanilla-theme, and vanilla overrides none of them. The plugin owns that look. The
other themes restyle, eject or re-place plugin UI their own way (`THEME-AUTHOR-GUIDE.md`).

- Put the look on semantic classes: `<ns>-<view>__<part>`, for example `market-product-card__title`.
- A `<style>` block in a view is allowed. The build rule `style-block-scope` keeps it contained, and it is an error:
  - every selector has a class that starts with `<ns>-`;
  - no `:global`;
  - `@keyframes` and custom properties are named `<ns>-...` / `--<ns>-...`;
  - read theme values through `var(--pano-*)`, never `var(--bs-*)`.
- The kit collects the blocks into `client/plugin.css`, inside `@layer pano-plugin`, and every theme links it. Unlayered theme
  CSS therefore wins over it.
- A class made at run time needs `styles.dynamicClassAllow` in `pano.plugin.js`; a `style=` attribute needs
  `styles.styleAttrAllow`. `bunx pano-plugin check` prints file, line and fix.

```svelte
<div class="faq-item"><h3 class="faq-item__q">{q}</h3></div>
<style>
  .faq-item { border-bottom: 1px solid var(--pano-border-color); }
  .faq-item__q { font-size: 1rem; }
</style>
```

## 7. The fallback rule and the panel report

Pano never blocks a plugin update because of a theme. The registry uses an override only while it fits:

1. no override: the plugin's default view;
2. the override's `contract` differs from the plugin's: the default renders, issue `CONTRACT_MISMATCH`;
3. a controller the override uses is pinned to another version than the plugin's: the default renders, issue
   `CONTROLLER_MISMATCH`;
4. the override fails to load: the default renders, issue `LOAD_FAILED`.

To update an outdated override: `eject-view <id>` writes `<file>.new` beside it, merge your changes, then run `accept <id>`.

The theme build writes `core-meta.json` (which views the theme overrides, at which contract). The panel reads it and each
plugin's `contract/views.json` and shows a badge on the theme, a list of fallen-back views and one dashboard alert while
the theme is `OUTDATED`. Issue types: `CONTRACT_MISMATCH`, `CONTROLLER_MISMATCH`, `VIEW_REMOVED`, `ENGINE_MISMATCH`,
`NAMESPACE_CLASH`. A plugin that is not installed is counted, never an issue.

## 8. Official plugins

Namespace and number of views of the official plugins, counted in `contract/views.json` of each built package.

| Plugin | `ns` | Views | Blocks you can place |
|---|---|---|---|
| market | `market` | 70 | `market:GoalWidget`, `market:NavCart`, `market:StatsWidget`, `market:RecentBuyersWidget`, `market:TopSupportersWidget` |
| social-login | `social-login` | 8 | none |
| premium-login | `premium-login` | 6 | none |
| auth-guard | `auth-guard` | 5 | none |
| countdown-timer | `countdown-timer` | 5 | `countdown-timer:CountdownTimerCover`, `countdown-timer:CountdownTimerSidebar` |
| comments | `comments` | 4 | `comments:ThemePostComments` |
| faq | `faq` | 3 | `faq:SupportFAQWrapper` |
| staff-page | `staff-page` | 3 | none |
| announcement, avatar, bans, cookies, media-page, pages, slider | same as the id | 1 each | none |
| link-redirects | `redirects` | 1 | none |
| whitelist | `whitelist` | 0 | none |

## 9. Checking

```sh
bunx @panomc/theme-core check            # in a theme
bunx @panomc/theme-core check --strict   # warnings count as errors
bunx pano-plugin check                   # in a plugin
```

The rules C1 to C16 are listed at the top of `packages/theme-core/bin/check.js`. See `THEME-AUTHOR-GUIDE.md` for the theme
side and `MIGRATION.md` for moving an SDK 1 plugin.
