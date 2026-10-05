# TC-9 fixture plugin

Test fixture for the browser run `TC-9` of the market plugin spec (design 15, section 10), executed in
E2E-19 against vanilla-theme. It is **not shipped**: it is not part of the `@panomc/theme-core` package
and has no build of its own. Build it like any plugin (copy `src/` into a scaffold from
`pano-boilerplate-plugin`, which provides the rollup config and the `@panomc/sdk` pin) and install the
jar into a dev instance with the locale file `src/locales/en-US.json` under `locales/`.

Plugin id: `tc9-fixture` (the toast key is `plugins.tc9-fixture.toast`).

| # | Page | Expected result |
|---|---|---|
| 1 | guest opens `/fixture/login-required` | 302 to `/login?redirect=%2Ffixture%2Flogin-required`; after login the page opens |
| 2 | `/fixture/hook` | the host `Hook` from `getPanoContext().context.components` renders client-side (record whether the SSR variant works: proven / not proven) |
| 3 | `/fixture/meta` | served HTML has exactly one `<meta name="description">` ("Fixture description"), `og:image`, canonical, one JSON-LD script |
| 4 | `/profile/fixture` (logged in) | profile card + nav list-group; the `Fixture` item has class `active`; built-in items present |
| 5 | `/fixture/sidebar-empty` and `/fixture/sidebar-one` | empty: content without `col-lg-8` and no aside; one item: `col-lg-8` content + aside with `[data-fixture=sidebar-item]` |
| 6 | `/fixture/toast`, click the button | the toast shows the text `<img src=x onerror=alert(1)>`; no alert, no `<img>` in the toast |
| 7 | `/fixture/title` | `<title>` starts with `buttons.save`, no `<h1>` / visible page title |

`pano.features.list()` on the theme must contain: `context-components`, `decoded-route-params`,
`layout-route-params`, `login-return-url`, `page-meta`, `page-sidebar-id`, `page-title-options`,
`plugin-notifications`, `profile-nav`, `toast-escaped-values`.
