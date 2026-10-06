# E2E-19 host fixture

Test only, never published. One plugin jar (`tc9-fixture`) plus a driver for the host integration checks of the market spec
(design 15 section 10): TC-9 (theme-core on vanilla), PUI-2 (panel-ui), P-4.3 (mail) and P-5.3 (panel notifications).

- `kotlin/` backend: plugin class, a `FIXTURE` panel notification type, the `view.fixture` permission node, `POST /api/panel/tc9-fixture/notify`
  (a plugin row and a core row) and `POST /api/panel/tc9-fixture/mail` (real `MailManager.sendMail` with `MailOptions`).
- `ui/` + `../tc9-fixture-plugin/src`: theme pages of TC-9 and panel pages of PUI-2 (`build.sh` assembles them like `pano-boilerplate-plugin`).
- `run/host-checks.mjs`: the checks (Playwright through the market's `e2e-browser/lib`), `run/smtp-sink.mjs` + `parse-eml.py`: the local SMTP sink.

TC-9 item 2 (SSR of a host component from a plugin bundle) runs against the PRODUCTION build of vanilla-theme: `./build-theme-prod.sh` once (private copy under
`.worktrees/e2e19-ui/vanilla-theme`, `E2E19_THEME_BUILD` overrides the build directory); the driver starts and stops that server itself.

Run (stream A, from the market checkout; the driver imports the market's e2e libs and its `playwright`):

```
./build.sh                                   # needs a built Pano jar; writes build/libs/tc9-fixture-local-build.jar
# host UIs: copy themes/vanilla-theme and panel-ui (rsync --exclude /.git --exclude /build --exclude /plugins) when another stream runs vite
# on the same checkouts, they write the same plugins/ directory and wipe each other's plugin bundles
MARKET_E2E_FAKE_JAR=$PWD/build/libs/tc9-fixture-local-build.jar MARKET_E2E_THEME_DIR=<copy> MARKET_E2E_PANEL_DIR=<copy> \
  scripts/e2e-instance.sh start --ui external:<theme port>,<panel port>      # the fixture jar replaces the fake gateway jar
eval "$(scripts/e2e-instance.sh status)"
bun <umbrella>/theme-core/test-fixtures/e2e19-host-fixture/run/host-checks.mjs [P-5.3 | P-4.3 | P-4.3b | TC-9 | PUI-2 ...]
```

The SMTP sink listens on a FIXED port (`E2E19_SMTP_PORT`, default 18597): the platform builds its SMTP client lazily on the first send and never
rebuilds it, so a later settings save with another port is ignored until the platform restarts.
