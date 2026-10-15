/**
 * `page` and `navigating` as stores, in the shape SvelteKit 2's `$app/stores` had.
 *
 * SvelteKit 3 removed `$app/stores`; `$app/state` replaces it with rune-based objects whose changes the legacy
 * (non-runes) syntax never sees. These stores read `$app/state`, so `$page` / `$navigating`, `get(page)` and `$:`
 * statements keep working in legacy components and plain modules.
 *
 * On the server `$app/state` can only be read while rendering: a subscription (what `$page` makes during render) takes
 * a snapshot then and never updates. In the browser the store follows the state.
 *
 * A plugin component is compiled with its own copy of Svelte's server runtime, and its `$page` can be read where the
 * host's component context is not current (`$app/state` then throws). The host's app layout calls
 * `captureRequestState()` while it renders, so such a read gets the page of the request being rendered (server
 * rendering is synchronous: no other request runs in between).
 */
import { navigating as navigatingState, page as pageState } from "$app/state";
import { browser } from "$app/env";
import { toStore } from "svelte/store";

function pageSnapshot() {
  return {
    url: pageState.url,
    params: pageState.params,
    route: pageState.route,
    status: pageState.status,
    error: pageState.error,
    data: pageState.data,
    form: pageState.form,
    state: pageState.state,
  };
}

/** `null` while no navigation runs, as the SvelteKit 2 store was. */
function navigatingSnapshot() {
  const navigation = navigatingState;

  if (!navigation.type) return null;

  return {
    from: navigation.from,
    to: navigation.to,
    type: navigation.type,
    willUnload: navigation.willUnload,
    delta: navigation.delta,
    complete: navigation.complete,
  };
}

/** The page of the request the server renders now (see `captureRequestState`). */
let requestPage = null;

/**
 * Takes the page of the request being rendered; called by the host's app layout during its render on the server.
 * A no-op in the browser.
 */
export function captureRequestState() {
  if (!browser) requestPage = pageSnapshot();
}

/**
 * @template T
 * @param {() => T} snapshot
 * @param {() => T | null} fallback  the server value when `$app/state` cannot be read here
 * @returns {import("svelte/store").Readable<T>}
 */
function stateStore(snapshot, fallback) {
  /** @type {import("svelte/store").Readable<T> | undefined} */
  let clientStore;

  return {
    subscribe(run, invalidate) {
      if (!browser) {
        let value;
        try {
          value = snapshot();
        } catch (error) {
          value = fallback();
          if (value === null) throw error;
        }
        run(value);
        return () => {};
      }

      clientStore ??= toStore(snapshot);

      return clientStore.subscribe(run, invalidate);
    },
  };
}

export const page = stateStore(pageSnapshot, () => requestPage);
// never navigating while the server renders
export const navigating = stateStore(navigatingSnapshot, () => null);
