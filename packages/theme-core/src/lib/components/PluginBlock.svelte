{#if Component}
  <Component {...data} {...rest} />
{:else if fallback}
  {@render fallback()}
{/if}

<script module>
  const warned = new Set();

  function warnNotBlock(blockId) {
    if (warned.has(blockId)) return;

    warned.add(blockId);
    console.warn(`[theme-core] <PluginBlock id="${blockId}"> load not called, the view is not a block (set block: true in its view record)`);
  }
</script>

<script>
  // `<PluginBlock id="market:ProductGrid" limit={8} category="vip" />` (doc 01 section 5).
  //
  // Renders the theme's override of the view `id`, else the plugin's default, with `{...data, ...rest}`.
  // `data` is per placement: `loadView` ran the view's `load(event, props)` once per distinct `blockKey`
  // and returned it under that key, so the block reads `$page.data[blockKey(id, rest)]`. Two grids with
  // different props get two data sets.
  //
  // - key missing from `$page.data` (a prop was not a literal, or the id is dynamic): the block calls the
  //   view's `load` in the browser after mount (the theme-core check warns about it, C7);
  // - view not preloaded (client navigation to a page that places it): it is resolved after mount;
  // - unknown id / plugin not installed: nothing, or the `fallback` snippet.
  import { untrack } from "svelte";
  import { page } from "$app/stores";
  import { browser, dev } from "$app/environment";
  import { getPanoContext } from "@panomc/sdk/internal";
  import {
    getDefault,
    describeView,
    getOverride,
    hasView,
    preloadViews,
    resolveViewModule,
  } from "$pano/registry/index.js";
  import { blockKey, stableJson } from "$pano/registry/view.js";

  let { id, fallback, ...rest } = $props();

  // Bumped when a view that was not preloaded has been resolved after mount.
  let resolvedAt = $state(0);
  /** @type {{ key: string, data: object } | null} */
  let loaded = $state(null);

  const key = $derived(blockKey(id, rest));
  const fromPage = $derived($page.data?.[key]);
  const data = $derived(fromPage ?? (loaded && loaded.key === key ? loaded.data : undefined));

  const Component = $derived.by(() => {
    // read so a late preload re-evaluates the lookup below
    resolvedAt;

    const override = getOverride(id);
    const Chosen = override ?? getDefault(id);

    if (!Chosen) return null;

    // `views.wrap` is the fallback-style hook of doc 03 (identity in a Bootstrap theme)
    const wrap = getPanoContext().context?.views?.wrap;

    return wrap?.(id, Chosen, override ? "override" : "default") ?? Chosen;
  });

  /** The little a block's `load(event, props)` needs in the browser (there is no SvelteKit event outside a load). */
  function browserEvent(current) {
    return {
      url: current.url,
      params: current.params,
      route: current.route,
      data: current.data,
      fetch: (...args) => globalThis.fetch(...args),
      parent: async () => current.data,
      depends() {},
      setHeaders() {},
      untrack: (fn) => fn(),
      isDataRequest: false,
      isSubRequest: false,
    };
  }

  $effect(() => {
    if (!browser) return;

    const blockId = id;
    const blockProps = untrack(() => JSON.parse(stableJson(rest)));
    const blockKeyNow = key;
    const hasData = fromPage !== undefined;
    const current = untrack(() => $page);
    let cancelled = false;

    (async () => {
      if (!getOverride(blockId) && !getDefault(blockId) && hasView(blockId)) {
        await preloadViews([blockId]);
        if (cancelled) return;
        resolvedAt++;
      }

      if (hasData) return;

      try {
        const result = await resolveViewModule(blockId);
        const load = result?.module?.load ?? result?.module?.default?.load;

        if (typeof load !== "function") return;

        // `load` runs only for a view that declares `block: true` (as `loadView` does on the server); any
        // other view is still placed and rendered with its props, without data.
        if (!describeView(blockId)?.block) {
          if (dev) warnNotBlock(blockId);

          return;
        }

        const output = await load(browserEvent(current), blockProps);

        if (!cancelled) loaded = { key: blockKeyNow, data: output ?? {} };
      } catch (e) {
        console.warn(`[theme-core] load of block '${blockId}' failed`, e);
      }
    })();

    return () => {
      cancelled = true;
    };
  });
</script>
