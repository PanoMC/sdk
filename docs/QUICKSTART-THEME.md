# Theme quick-start

A theme that looks different from vanilla, in four steps. The scaffold is `theme-core new`; the theme dev server needs one
field in the panel, set once.

```
bunx @panomc/theme-core new my-theme     # 4 questions; installs
cd my-theme && bun run dev:ui            # set the panel field it prints, once; then open your Pano address
Colours:     src/styles/tokens.scss
Own a view:  bunx theme-core eject-view HomeView   |   eject-view market:ProductCard
Everything:  <your Pano address>/__pano/views
Names:       view "market:ProductCard" → eject-view / pluginView()      controller "market/cart" → plugin('market').use('cart')
             versions of both live in theme.config.js (views, controllers); eject-view and check --fix write them
Ship:        bun run check && bun run build && bun run package
```

**Steps to first result: 3 (scaffold, dev, one panel field), 0 files written, the panel stays up. A theme that looks
different from vanilla is 4: the same three, then one edit in `src/styles/tokens.scss`.**

The wizard installs for you. `new my-theme` with a name asks nothing and does not install: run `bun install` in the folder
first (a fourth command before `dev:ui`; the first install is enough, it generates the routes, language files and bridges).

## While the engine is unpublished

`new my-theme --local` (the default until `@panomc/theme-core` is on npm) links the theme to this checkout: `package.json`
carries `file:` dependencies and an `overrides` entry for `@panomc/sdk` (the engine asks for it as a workspace package,
which cannot resolve outside the workspace), and `bunfig.toml` selects bun's hoisted linker, because the default one copies
a `file:` package only on the second install. With both, the first `bun install` passes.

## The panel field

While `frontend.dev-url` is set, the front-end mode is `THEME` and Development Mode is on: Pano does not start the theme
process and proxies `/*` to that URL, while the panel, setup and plugin UIs run as usual. In the panel it is the field
"Theme dev server" under Development Mode. `bun run dev:ui` starts with `theme-core dev-hint`, which prints, once, two lines

```
dev  Panel → Appearance → Front-end → Theme dev server: http://localhost:3000
dev  Development Mode must be on (Panel → Platform Settings → Development Mode).
```

The field only starts the proxy while Development Mode is on, so switch that on first, then save the field. No `config.conf` edit and no Pano restart are needed.

## Going further

- Colours, radius and fonts: `src/styles/tokens.scss` is a commented menu of every token.
- A view of your own: `eject-view <Name>` copies the readable source into the theme and writes the entry in
  `theme.config.js`. A plugin's view is ejected by its id (`market:ProductCard`); the registry uses the copy only while its
  `contract` matches the plugin, otherwise the plugin's own view renders and the panel shows a warning.
- `check --fix` adds `controllers` pins for literal `plugin().use()` calls.
- All views of the running site, with sample data: `<your Pano address>/__pano/views`.

The longer reference is `THEME-AUTHOR-GUIDE.md`.
