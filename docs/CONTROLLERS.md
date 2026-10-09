# Controllers

A controller is the logic of a plugin feature (a cart, a session, a price formatter) written once as a plain JavaScript
object. Plugin views, theme pages, web components and non-Svelte front-ends all use the same one. Views are in
`PLUGIN-VIEWS.md`.

A controller is named `<ns>/<name>` (`market/cart`, a slash; views use a colon) and has a version.

## 1. Writing one

A controller is a file `src/theme/controllers/<name>.js` whose default export is a `defineController` result. That is all
the registration there is. Files starting with `_`, sub-folders and `types.js` are private code or typedefs.

```js
// src/theme/controllers/counter.js
import { defineController } from '@panomc/plugin-kit/controller';

export default defineController({
  name: 'counter',
  version: 1,
  state: () => ({ count: 0 }),
  actions: (c) => ({
    add() {
      c.update((s) => ({ ...s, count: s.count + 1 }));
      return { ok: true };
    },
  }),
});
```

| Key | Meaning |
|---|---|
| `name`, `version` | camelCase name, unique in the plugin; integer version, at least 1. One version per name |
| `scope` | `'app'` (default): one per page. `'instance'`: a new one per `use()` |
| `eager` | app scope: created and started right after the plugin registers, in the browser |
| `state` | returns the initial state with every public key; the build reads the keys from it |
| `actions` | plain functions. Expected failures return `{ ok: false, code }`, they do not throw |
| `start` | browser only. Runs with the first subscriber; the returned function runs after the last one leaves |
| `load` | server-safe page loader without instance state; used by `view.controller` |

The state passed around is a snapshot: `get()` returns it, `subscribe(run)` calls `run` once at once and on every change,
`set` and `update` notify only when the value changed. `get` plus `subscribe` is the Svelte store contract, so `$cart`
works. `createState` and `derive` build small stores for helpers.

A controller imports no framework (`svelte*`, `@panomc/sdk*`, `$app/*`). It reaches the world only through its host.
Packages may be imported: they are bundled into the compiled controller.

## 2. Hosts

`host` is what a controller gets as `c.host`:

| Member | What it does |
|---|---|
| `request({ method, path, query, body })` | API call, parsed body; failures resolve `{ error: { code } }`, never reject |
| `session()`, `onSession(fn)` | `{ user, csrfToken }`; `onSession` fires at first bind, login and logout |
| `locale()`, `t(key, values)`, `toast(key, opts)` | text and notifications |
| `storage(kind)`, `now()`, `navigate(url)` | browser storage (or null), the clock, a client-side redirect |
| `feature(name)`, `loginUrl(returnTo)`, `registerUrl(returnTo)` | platform features and auth links |

Three hosts exist:

- **Theme host**: `createThemeHost({ event })`, used by the engine. On the server it needs the request `event`.
- **Fetch host**: `createFetchHost({ baseUrl, ... })`, for web components, the starter and any other front-end.
- **Null host**: `nullHost` (guest session, `request` resolves `NULL_HOST`). The build uses it to list a controller's keys.

## 3. The registry

The registry lives on `globalThis`, so the two server copies of Svelte share it. It is `pano.controllers`:

```js
register(pluginId, namespace, definitions)  // generated entry code calls this; a name registered again replaces
use(name, { version, params, initial, event })   // Controller or null
load(name, { version, params, event })           // page data or null
has(name, version)   list()   reset()
```

`use` never throws. An unknown name or a version other than the one asked for returns `null` and tells the mismatch
listeners; the dev console says which. Plugin updates are never blocked by this.

The compiled controllers are also served as one standalone module, `controllers/controllers.mjs` in the plugin package, for
pages outside Svelte:

```js
const market = await import('https://example.com/api/v1/plugins/pano-plugin-market/_/ui/controllers/controllers.mjs');
const cart = market.create('cart', market.createHost({ baseUrl: 'https://example.com' }));
cart.subscribe((s) => (badge.textContent = s.count));
```

## 4. Pins

Plugin views always match: the build stamps the current version into every controller call of a compiled view. A theme
asks for a version through its pins in `theme.config.js`:

```js
controllers: { "market/cart": 1, "market/format": 1 },
```

If a pin differs from the version the plugin has, `use` returns `null`. For an overridden view the registry then shows the
plugin's default view and the panel lists `CONTROLLER_MISMATCH`. `eject-view` writes the pins for you, and

```sh
bunx @panomc/theme-core check --fix
```

adds the pins for every literal `plugin('market').use('cart')` in the theme and updates outdated ones.
`bunx @panomc/theme-core accept <id>` re-pins an override. Both need `contracts pull` to have run, which `sync` does.

The build records state and action keys of each controller in `pano-plugin.lock.json`. A removed or renamed key without a
higher `version` fails `bun run build`; an added key only updates the lock.

## 5. The Svelte wrapper

`@panomc/sdk/controllers` turns a controller into something a Svelte component reads without stores:

```svelte
<script>
  import { plugin } from '@panomc/sdk/controllers';
  const cart = plugin('market').use('cart');   // null if market is missing or the version differs
</script>
{#if cart}
  <button onclick={() => cart.actions.clear()}>{cart.state.count} items</button>
{/if}
```

| Call | Result |
|---|---|
| `plugin(ns).use(name, opts)` | `{ state, actions, controller }` or `null` |
| `plugin(ns).require(name, opts)` | the same, or it throws `market/cart is not available` (for a plugin's own views) |
| `plugin(ns).load(name, opts)` | the controller's page data |
| `plugin(ns)._` | readable store of `(key, values) => text`, prefixed `plugins.<pluginId>.` |
| `plugin(ns).toast(key, { variant })` | a toast with the same prefix |
| `reactive(controller)`, `useController(name, opts)` | the pieces `plugin()` is built from |

`state` is a getter that tracks changes, so read it in a template or an `$effect`; keep the whole `cart` object, do not
destructure `state` once. The wrapper is plain JavaScript on `createSubscriber`, not rune files. An `'instance'`
controller is destroyed when the component unmounts. On the server no controller is cached and none starts eagerly.

## 6. Checking

```sh
bunx pano-plugin check
bun test packages/plugin-kit
```

`pano-plugin check` applies the import rules (a controller importing `svelte/store` fails with the chain). The core of
`defineController` lives in `packages/plugin-kit/src/controller/index.js` and the registry in
`packages/sdk/core/js/ControllerRegistry.js`.
