# Plugin quick-start

A Pano plugin that shows one page on the site, in three steps and with no file written by hand. The scaffold is
`pano-plugin new` (`@panomc/plugin-kit`); everything it writes comes from one template folder in the kit.

```
Needs: JDK 17+, Bun, Pano with Development Mode on
cd <pano>/plugins && bunx @panomc/plugin-kit new my-plugin    # installs
cd my-plugin && bun run dev        # first run builds the jar (minutes); restart Pano once, then open /my-plugin
New page:     src/theme/views/X.svelte with  export const view = { path: '/x' }
Helper:       any .js beside it, imported as usual (ships readable)
Closed logic: src/theme/controllers/x.js   ->   plugin('my-plugin').require('x')
Panel page:   src/main.js  ->  pano.ui.page.register({ path, component })   (unchanged)
Look:         classes <ns>-x__part; a <style> block is allowed (every selector starts with .<ns>-)
Sample data:  bunx pano-plugin samples X          Check: bunx pano-plugin check
```

**Steps to first result: 3 (scaffold, dev, restart Pano), 0 files written.**

A fresh scaffold builds against the Pano version it pins without an edit: `build.gradle.kts` imports `java.util.Properties` and
`java.util.zip.ZipFile` at the top, `GetHelloAPI` declares `getValidationHandler` (so it compiles against the pinned tag and
the current Pano), and `gradle.properties` has `apiLevel=1` active, because the pinned dependency carries no API level and
Pano refuses a plugin without one ("needs API level 0"). Delete that line once the Pano dependency carries the level.

Run `new` inside Pano's `plugins/` folder: the folder is always the plugin id, because Pano finds a plugin's development
sources at `plugins/<pluginId>`. Without an id it asks five questions (id, name, author, Kotlin package, install now);
`new <id> [--package x.y] [--local <theme-core dir>]` asks nothing. An existing folder is refused.

## What you get

| File | What it is |
|---|---|
| `src/theme/views/HelloPage.svelte` | the page, at `/my-plugin`; it shows the answer of `GetHelloAPI` |
| `src/main/kotlin/<package>/routes/GetHelloAPI.kt` | `GET /api/plugins/my-plugin/hello`, declared as `/hello` |
| `src/main/kotlin/<package>/MyPlugin.kt` | the plugin class |
| `src/main/resources/frontend-targets.json` | links the plugin sends out (empty), with a commented fallback page beside the Kotlin sources |
| `build.gradle.kts`, `gradle.properties`, Gradle wrapper | the build; `copyJar` puts the jar in `panoPluginsDir` (`..`) unless it is built inside the platform tree |
| `package.json`, `rollup.config.js` | two devDependencies (`@panomc/sdk`, `@panomc/plugin-kit`) and a two-line rollup file |

The simplest page the author ever writes:

```svelte
<!-- src/theme/views/HelloPage.svelte -->
<script module>export const view = { path: '/hello' };</script>
<h1>Hello</h1>
```

The simplest endpoint and its call:

```kotlin
@Endpoint
class GetHelloAPI : Api() {
    override val paths = listOf(Path("/hello", RouteType.GET))
    override suspend fun handle(context: RoutingContext) = Successful(mapOf("message" to "hi"))
}
```
```js
import { api } from '@panomc/sdk/plugin-api';
const body = await api.get({ path: '/hello', request: event });
```

`bun run dev` is `pano-plugin dev`: it builds the jar once (with `-Pnoui`) when none exists, checks that Development Mode is
on, then watches the UI. `./gradlew build` builds the jar with the UI; `bun run check` is `pano-plugin check`.

## Styling

The page is drawn in the vanilla look unless a theme restyles it. Put the look on semantic classes of your own and, where
needed, in a `<style>` block of the view. The `style-block-scope` rule is an error at build: every selector starts with a
class `<ns>-...`, no `:global`, keyframes and custom properties are named `<ns>-...`. Read theme values with `var(--pano-*)`.
`bunx pano-plugin check` names file, line and fix. See `PLUGIN-VIEWS.md` section 6.

## While the kit is unpublished

`new --local <theme-core dir>` (the default until the packages are on npm) writes `file:` dependencies on the checkout's
`packages/plugin-kit` and `packages/sdk`.
